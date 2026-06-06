//! Install a setup tool (winget / npm-global). Streams output through the
//! same `ProgressEvent` channel `projects::create` uses, so the UI's deploy
//! terminal works for installs too.
//!
//! `run_all` is the one-click "set up the remote environment" entry point:
//! it picks every missing essential/recommended tool that has an auto-install
//! path and installs them sequentially through ONE event sink.

use crate::error::{AppError, AppResult};
use crate::projects::create::{EventSink, ProgressEvent, Step};
use crate::setup::{detect_all, install_command, ToolStatus};
use crate::wrangler::{self, CmdLine};

pub async fn run(tool_id: String, events: EventSink) -> AppResult<()> {
    let tools = detect_all();
    let tool = tools
        .into_iter()
        .find(|t| t.id == tool_id)
        .ok_or_else(|| AppError::Other {
            message: format!("unknown tool: {tool_id}"),
        })?;
    let info = tool.install.clone().ok_or_else(|| AppError::Other {
        message: format!("{} has no auto-install method on this OS.", tool.label),
    })?;
    let (program, args) = install_command(&info).ok_or_else(|| AppError::Other {
        message: format!("Can't auto-install ({}). Visit: {}", info.kind, info.target),
    })?;

    let _ = events.send(ProgressEvent::StepStart {
        step: Step::Deploy,
        label: format!("Installing {}…", tool.label),
    });

    let args_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let tx = events.clone();
    let result = wrangler::run_streaming(
        &program,
        &args_refs,
        std::path::Path::new("."),
        &[],
        move |line: CmdLine| {
            let _ = tx.send(ProgressEvent::Line { line });
        },
    )
    .await;

    match result {
        Ok(_) => {
            let _ = events.send(ProgressEvent::StepDone { step: Step::Deploy });
            let _ = events.send(ProgressEvent::Success {
                url: None,
                folder: String::new(),
            });
            Ok(())
        }
        Err(e) => {
            let _ = events.send(ProgressEvent::Error {
                step: Step::Deploy,
                message: e.to_string(),
            });
            Err(e)
        }
    }
}

/// Recognise winget / pnpm "already installed at latest" exit messages so
/// the installer pipeline can treat them as success instead of failure.
fn is_already_installed(error_msg: &str) -> bool {
    // winget: 0x8A150073 = APPINSTALLER_CLI_NO_APPLICABLE_UPGRADE_FOUND
    error_msg.contains("-1978335189")
        || error_msg.contains("0x8A150073")
        || error_msg.contains("No available upgrade found")
        || error_msg.contains("No newer package versions are available")
        || error_msg.to_lowercase().contains("already installed")
}

/// Returns the list of tools that `run_all` would install, in install order.
/// Order matters: Node before pnpm (pnpm uses npm), tooling before things
/// that depend on it.
pub fn missing_required() -> Vec<ToolStatus> {
    // Treat essential + recommended as "set me up". Optional editors (code,
    // cursor) are left out — installing them silently would be presumptuous.
    let mut out: Vec<ToolStatus> = detect_all()
        .into_iter()
        .filter(|t| !t.installed)
        .filter(|t| t.install.is_some())
        .filter(|t| t.importance == "essential" || t.importance == "recommended")
        .collect();
    // Stable ordering by importance then by `detect_all`'s natural order.
    out.sort_by_key(|t| match t.importance.as_str() {
        "essential" => 0,
        "recommended" => 1,
        _ => 2,
    });
    out
}

/// Install every missing essential/recommended tool sequentially. Streams
/// all subprocess output through `events`. Per-tool failures are surfaced
/// as stderr lines but do not stop the rest of the queue — the user can
/// see what failed and retry that one manually.
pub async fn run_all(events: EventSink) -> AppResult<()> {
    let tools = missing_required();
    if tools.is_empty() {
        let _ = events.send(ProgressEvent::StepStart {
            step: Step::Deploy,
            label: "Nothing to install — every essential tool is already present.".into(),
        });
        let _ = events.send(ProgressEvent::StepDone { step: Step::Deploy });
        let _ = events.send(ProgressEvent::Success {
            url: None,
            folder: String::new(),
        });
        return Ok(());
    }

    let total = tools.len();
    let mut had_failure = false;
    for (i, tool) in tools.iter().enumerate() {
        let _ = events.send(ProgressEvent::StepStart {
            step: Step::Deploy,
            label: format!("[{}/{total}] Installing {}…", i + 1, tool.label),
        });

        let info = match tool.install.as_ref() {
            Some(i) => i,
            None => {
                let _ = events.send(ProgressEvent::Line {
                    line: CmdLine::Stderr {
                        text: format!("Skipping {}: no auto-install on this OS.", tool.label),
                    },
                });
                continue;
            }
        };
        let (program, args) = match install_command(info) {
            Some(c) => c,
            None => {
                let _ = events.send(ProgressEvent::Line {
                    line: CmdLine::Stderr {
                        text: format!(
                            "Skipping {}: install kind '{}' not supported here. Visit {}.",
                            tool.label, info.kind, info.target
                        ),
                    },
                });
                continue;
            }
        };

        let args_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let tx = events.clone();
        let result = wrangler::run_streaming(
            &program,
            &args_refs,
            std::path::Path::new("."),
            &[],
            move |line: CmdLine| {
                let _ = tx.send(ProgressEvent::Line { line });
            },
        )
        .await;

        match result {
            Ok(_) => {
                let _ = events.send(ProgressEvent::Line {
                    line: CmdLine::Stdout { text: format!("✓ {} installed", tool.label) },
                });
                let _ = events.send(ProgressEvent::StepDone { step: Step::Deploy });
            }
            Err(e) if is_already_installed(&e.to_string()) => {
                // winget returns -1978335189 (0x8A150073, NO_APPLICABLE_UPGRADE_FOUND)
                // when the package is already at the latest version. From our
                // perspective the tool IS available, which is success — the user's
                // detector logic just missed it.
                let _ = events.send(ProgressEvent::Line {
                    line: CmdLine::Stdout {
                        text: format!("✓ {} already installed at the latest version", tool.label),
                    },
                });
                let _ = events.send(ProgressEvent::StepDone { step: Step::Deploy });
            }
            Err(e) => {
                had_failure = true;
                let _ = events.send(ProgressEvent::Line {
                    line: CmdLine::Stderr {
                        text: format!("✗ {} failed: {e}", tool.label),
                    },
                });
                let _ = events.send(ProgressEvent::StepDone { step: Step::Deploy });
            }
        }
    }

    if had_failure {
        let _ = events.send(ProgressEvent::Error {
            step: Step::Deploy,
            message: "Some tools failed to install — see the log above for details.".into(),
        });
        Err(AppError::Other {
            message: "one or more installs failed".into(),
        })
    } else {
        let _ = events.send(ProgressEvent::Success {
            url: None,
            folder: String::new(),
        });
        Ok(())
    }
}
