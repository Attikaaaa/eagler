type KeepStatus = { fs: boolean; persisted: boolean; folder: string | null; granted: boolean; last: { n: number; at: number; name: string } | null };
type KeepResult = { ok: boolean; reason?: string; n?: number; name?: string; prev?: number };
interface Window {
  Keep: {
    hasFS: boolean;
    status(): Promise<KeepStatus>;
    chooseFolder(): Promise<unknown>;
    backup(ask: boolean): Promise<KeepResult>;
    restore(ask: boolean): Promise<KeepResult>;
    download(): Promise<KeepResult>;
    upload(f: File): Promise<KeepResult>;
    cloud: { pull(): Promise<KeepResult & { changed?: boolean }>; push(): Promise<KeepResult & { same?: boolean; mb?: number; merged?: boolean }>; status(): Promise<{ token: boolean; last: { at: number } | null }> };
  };
}
