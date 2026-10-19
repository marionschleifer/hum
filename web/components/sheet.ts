import { h, mount } from "../dom.ts";
import { refresh } from "../state.ts";

type OpenSheet = { dialog: HTMLDialogElement; finish: (fromBack: boolean) => void };

const openSheets: OpenSheet[] = [];
let ownBackSteps = 0;

window.addEventListener("popstate", () => {
  if (ownBackSteps > 0) {
    ownBackSteps--;
    return;
  }
  openSheets.at(-1)?.finish(true);
});

export function openSheet(label: string, build: (close: () => void) => Node): void {
  const dialog = h("dialog", { class: "sheet", "aria-label": label });
  let finished = false;
  const finish = (fromBack: boolean) => {
    if (finished) return;
    finished = true;
    openSheets.splice(openSheets.findIndex((sheet) => sheet.dialog === dialog), 1);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (!fromBack) {
      ownBackSteps++;
      history.back();
    }
    void refresh();
  };
  dialog.addEventListener("close", () => finish(false));
  document.body.append(dialog);
  mount(dialog, build(() => finish(false)));
  history.pushState({ humSheet: openSheets.length + 1 }, "");
  openSheets.push({ dialog, finish });
  dialog.showModal();
}
