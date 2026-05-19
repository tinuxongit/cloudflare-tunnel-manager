pub mod detect;
pub mod supervisor;
pub mod setup_guide;

pub use detect::{detect, DetectedKind};
pub use supervisor::LocalSupervisor;
