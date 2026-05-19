pub mod detect;
pub mod supervisor;

pub use detect::{detect, DetectedKind};
pub use supervisor::LocalSupervisor;
