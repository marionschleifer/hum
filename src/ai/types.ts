import type { Recurrence } from "../recurrence/recurrence.ts";
import type { Priority, Size } from "../tasks/tasks.ts";

export type CaptureContext = {
  today: string;
  weekday: string;
  themes: { name: string; isAccounto: boolean }[];
  projects: { name: string; theme: string }[];
};

export type StructuredTask = {
  title: string;
  notes?: string;
  theme?: string;
  project?: string;
  confident: boolean;
  size?: Size;
  deadline?: string;
  essential?: boolean;
  priority?: Priority;
  recurrence?: Recurrence;
  subtasks: string[];
};

export type StructureCapture = (text: string, context: CaptureContext) => Promise<unknown>;

export type Transcribe = (audio: Blob) => Promise<string>;
