pub mod detect;
pub mod supervisor;
pub mod setup_guide;
pub mod static_server;

pub use detect::{detect, DetectedKind, EMBEDDED_STATIC};
pub use supervisor::LocalSupervisor;
