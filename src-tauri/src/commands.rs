use tauri::State;
use crate::state::AppState;
use crate::db::models::*;
use crate::db::queries;
use crate::error::AppResult;

#[tauri::command]
pub fn list_pages(state: State<AppState>) -> AppResult<Vec<Page>> {
    let g = state.db.lock();
    queries::list_pages(&g)
}

#[tauri::command]
pub fn create_page(state: State<AppState>, input: NewPageInput) -> AppResult<Page> {
    let g = state.db.lock();
    queries::insert_page(&g, &input)
}

#[tauri::command]
pub fn update_page(state: State<AppState>, id: i64, patch: PagePatch) -> AppResult<Page> {
    let g = state.db.lock();
    queries::update_page(&g, id, &patch)
}

#[tauri::command]
pub fn delete_page(state: State<AppState>, id: i64) -> AppResult<()> {
    let g = state.db.lock();
    queries::delete_page(&g, id)
}

#[tauri::command]
pub fn toggle_page(state: State<AppState>, id: i64, on: bool) -> AppResult<Page> {
    let g = state.db.lock();
    let patch = PagePatch { enabled: Some(on), ..Default::default() };
    queries::update_page(&g, id, &patch)
    // NOTE: actual proc restart is wired in Task 19 (orchestrator)
}
