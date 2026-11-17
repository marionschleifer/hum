import { learningApi, type BookStatus, type LearningItem, type LearningKind } from "../api.ts";
import { taskRow } from "../components/task-row.ts";
import { h, mount, toast } from "../dom.ts";
import { refresh } from "../state.ts";

const KIND_LABELS: Record<LearningKind, string> = { task: "Task", book: "Book", video: "Video" };
const PLACEHOLDERS: Record<LearningKind, string> = {
  task: "Something to learn or practise",
  book: "Book title",
  video: "Paste a YouTube link",
};

let addKind: LearningKind = "book";

export async function renderLearning(root: HTMLElement): Promise<void> {
  const list = await learningApi.list();
  mount(
    root,
    h("header", { class: "page" }, h("h1", {}, "Learning")),
    addForm(root),
    section("Reading", list.reading, (item) => bookButtons(item, [["Not reading now", "to_read"]]), "No book on the go. Start one from To read."),
    section("Videos", list.videos, videoLink),
    section("Tasks", list.tasks),
    section("To read", list.toRead, (item) => bookButtons(item, [["Start reading", "reading"]])),
    list.read.length
      ? h(
          "details",
          { style: "margin-top:20px" },
          h("summary", { class: "muted" }, `Read (${list.read.length})`),
          h("div", { class: "card", style: "margin-top:8px" }, list.read.map((item) => taskRow(item, { extra: bookButtons(item, [["Back to To read", "to_read"]]) }))),
        )
      : undefined,
  );
}

function addForm(root: HTMLElement): HTMLElement {
  const input = h("input", { type: "text", placeholder: PLACEHOLDERS[addKind], "aria-label": PLACEHOLDERS[addKind] });
  const kinds = h(
    "div",
    { class: "segmented", role: "group", "aria-label": "What to add" },
    (Object.keys(KIND_LABELS) as LearningKind[]).map((kind) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": addKind === kind ? "true" : "false",
          onclick: () => {
            addKind = kind;
            void renderLearning(root);
          },
        },
        KIND_LABELS[kind],
      ),
    ),
  );
  const submit = h("button", { type: "submit", class: "btn" }, "Add");
  return h(
    "form",
    {
      style: "display:grid;gap:8px;margin-bottom:8px",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        submit.disabled = true;
        try {
          await learningApi.add(addKind === "video" ? { kind: "video", url: value } : { kind: addKind, title: value });
          toast(`${KIND_LABELS[addKind]} added`);
          await refresh();
        } catch (error) {
          toast((error as Error).message, "error");
          submit.disabled = false;
        }
      },
    },
    kinds,
    h("div", { class: "row", style: "flex-wrap:nowrap" }, input, submit),
  );
}

function section(title: string, items: LearningItem[], extra?: (item: LearningItem) => Node, empty?: string): HTMLElement[] {
  if (items.length === 0 && !empty) return [];
  return [
    h("h2", {}, title),
    h(
      "div",
      { class: "card" },
      items.length ? items.map((item) => taskRow(item, { extra: extra?.(item) })) : h("div", { class: "empty" }, empty),
    ),
  ];
}

function videoLink(item: LearningItem): Node {
  return h(
    "div",
    { class: "meta" },
    item.url
      ? h("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", onclick: (event: Event) => event.stopPropagation() }, "Open video")
      : undefined,
  );
}

function bookButtons(item: LearningItem, actions: [string, BookStatus][]): Node {
  return h(
    "div",
    { class: "row", style: "margin-top:6px", onclick: (event: Event) => event.stopPropagation() },
    actions.map(([label, status]) =>
      h(
        "button",
        {
          type: "button",
          class: "chip",
          onclick: async () => {
            try {
              await learningApi.book(item.id, status);
              await refresh();
            } catch (error) {
              toast((error as Error).message, "error");
            }
          },
        },
        label,
      ),
    ),
  );
}
