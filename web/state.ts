import { api, tasksApi, type Project, type Theme } from "./api.ts";

export const store = {
  themes: [] as Theme[],
  projects: [] as Project[],
  inboxCount: 0,
  rerender: async () => {},
};

export async function loadReference(): Promise<void> {
  const [themes, projects, inbox] = await Promise.all([
    api<Theme[]>("GET", "/api/themes"),
    api<Project[]>("GET", "/api/projects"),
    tasksApi.list({ status: "inbox" }),
  ]);
  store.themes = themes;
  store.projects = projects;
  store.inboxCount = inbox.filter((task) => !task.parentId).length;
}

export async function refresh(): Promise<void> {
  await loadReference();
  await store.rerender();
}

export function themeById(id: string | undefined): Theme | undefined {
  return store.themes.find((theme) => theme.id === id);
}

export function projectById(id: string | undefined): Project | undefined {
  return store.projects.find((project) => project.id === id);
}
