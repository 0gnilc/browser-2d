import type { UpdatesApi } from './updates';
import type { Browser, BrowserCreate, BrowserUpdate, BrowserId } from './browsers';
import type { Card, CardUpdate, CardId, CardQuery, CardPage, ImportReport } from './cards';
import type { WorkTask, StopView } from './work-tasks';
import type { SettingsView, SettingsSave, SettingsSaveOutcome } from './settings';
import type { Result } from './result';
export * from './result';
export * from './updates';
export * from './browsers';
export * from './cards';
export * from './work-tasks';
export * from './settings';
export * from './limits';
export interface Browser2dApi {
  browsers: {
    list(): Promise<Result<Browser[]>>;
    create(input: BrowserCreate): Promise<Result<Browser>>;
    update(input: BrowserUpdate): Promise<Result<Browser>>;
    remove(input: { id: BrowserId }): Promise<Result<{ removed: true }>>;
  };
  cards: {
    list(input: CardQuery): Promise<Result<CardPage>>;
    importText(input: { text: string }): Promise<Result<ImportReport>>;
    update(input: CardUpdate): Promise<Result<Card>>;
    remove(input: { id: CardId }): Promise<Result<{ removed: true }>>;
  };
  workTasks: {
    list(): Promise<Result<WorkTask[]>>;
    start(input: { browserId: BrowserId }): Promise<Result<WorkTask>>;
    stop(input: { browserId: BrowserId }): Promise<Result<StopView>>;
    subscribe(listener: () => void): () => void;
  };
  settings: {
    get(): Promise<Result<SettingsView>>;
    save(input: SettingsSave): Promise<Result<SettingsSaveOutcome>>;
  };
  updates: UpdatesApi;
}
