use std::collections::VecDeque;
use parking_lot::Mutex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub stream: &'static str,   // "stdout" | "stderr"
    pub text: String,
    pub ts_ms: u64,
}

pub struct LogBuffer {
    cap: usize,
    inner: Mutex<VecDeque<LogLine>>,
}

impl LogBuffer {
    pub fn new(cap: usize) -> Self {
        Self { cap, inner: Mutex::new(VecDeque::with_capacity(cap)) }
    }
    pub fn push(&self, stream: &'static str, text: String) {
        let ts_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let mut g = self.inner.lock();
        if g.len() == self.cap { g.pop_front(); }
        g.push_back(LogLine { stream, text, ts_ms });
    }
    pub fn last(&self, n: usize) -> Vec<LogLine> {
        let g = self.inner.lock();
        let take = n.min(g.len());
        g.iter().rev().take(take).cloned().collect::<Vec<_>>().into_iter().rev().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_bounds() {
        let b = LogBuffer::new(3);
        for i in 0..5 { b.push("stdout", format!("line {i}")); }
        let last3 = b.last(10);
        assert_eq!(last3.len(), 3);
        assert_eq!(last3[0].text, "line 2");
        assert_eq!(last3[2].text, "line 4");
    }
}
