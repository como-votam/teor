/** Static vocabulary only. No arbitrary payload, identity, URL, search, SQL or answer API. */
export const EVENTS = [
  'page_view', 'navigation_header', 'navigation_footer', 'navigation_content',
  'navigation_mobile', 'navigation_menu_opened', 'navigation_menu_closed', 'external_link_opened', 'download_clicked',
  'back_to_top', 'section_viewed', 'page_middle_reached', 'page_end_reached',
  'tab_changed', 'filter_changed', 'select_changed', 'details_opened', 'details_closed',
  'sheet_opened', 'sheet_closed', 'copy_succeeded', 'copy_failed',
  'search_opened', 'search_used', 'search_result_opened', 'search_closed', 'search_load_failed',
  'runs_search_used', 'runs_filter_changed', 'runs_filters_cleared', 'runs_sorted', 'runs_page_changed',
  'explorer_more_loaded', 'matrix_picker_opened', 'matrix_search_used', 'select_opened', 'select_search_used',
  'matrix_model_changed', 'matrix_provider_changed', 'matrix_reset', 'matrix_track_changed',
  'matrix_slice_opened', 'matrix_exported', 'hemicycle_item_opened', 'hemicycle_group_opened',
  'track_selected', 'pipeline_step_selected',
  'comparison_opened', 'comparison_pair_changed',
  'explorer_filter_changed', 'explorer_search_used', 'explorer_filters_cleared',
  'explorer_item_viewed', 'explorer_item_failed', 'explorer_index_failed', 'explorer_history_expanded',
  'sql_started', 'sql_succeeded', 'sql_failed', 'sql_exported',
  'quiz_started', 'quiz_question_viewed', 'quiz_answered', 'quiz_skipped', 'quiz_validation_failed',
  'quiz_next', 'quiz_completed', 'quiz_restarted', 'quiz_exited',
] as const;
export type AnalyticsEvent = (typeof EVENTS)[number];
const allowed = new Set<string>(EVENTS);
export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === 'string' && allowed.has(value);
}

type Sink = (event: AnalyticsEvent) => void;
let sink: Sink = () => {};
export function setAnalyticsSink(next: Sink): void { sink = next; }
export function track(event: AnalyticsEvent): void {
  if (!isAnalyticsEvent(event)) return;
  // Analytics must never break a site interaction (blocked scripts, storage, extensions).
  try { sink(event); } catch { /* Best effort. No logs containing visitor data. */ }
}
