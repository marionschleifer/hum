export function privacyPage(ownerName: string | undefined): string {
  const owner = escapeHtml(ownerName ?? "its owner");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hum privacy</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 16px; background: Canvas; color: CanvasText; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 28px 0 6px; }
</style>
</head>
<body>
<h1>Hum privacy</h1>
<p>Hum is a personal planner. This copy of Hum is used by ${owner} alone. Nobody else has an account on it.</p>

<h2>What Hum reads from Google</h2>
<p>Hum asks for read-only access to Google Calendar. It reads the calendars ${owner} chooses in Settings, to count meetings against the time planned for each part of the day. Hum never creates, changes or deletes calendar events.</p>
<p>If ${owner} connects Gmail, Hum asks for read-only access to that mailbox. Once a day it looks at recent threads to find mails ${owner} sent that are still waiting for an answer, and important mails ${owner} has not answered yet, and turns them into tasks. It reads the sender, the recipients, the subject and the short preview Gmail shows, not attachments. Hum never sends, changes or deletes email.</p>

<h2>Where the data is kept</h2>
<p>Tasks, plans and the Google access token are stored in a database on ${owner}'s own server. Hum does not sell, share or publish this data, and it does not use it for advertising.</p>

<h2>Services Hum uses</h2>
<p>To sort tasks and plan the day, Hum sends task text and the titles and times of that day's meetings to Anthropic's Claude API. To decide which mails need a task, it sends the sender, recipients, subject and preview of those mails to the same API. Voice notes are sent to OpenAI for transcription. All of this is used only to answer that request.</p>

<h2>Removing access</h2>
<p>Google access, for the calendar and for Gmail, can be removed at any time in Hum's Settings, or in the Google account under Security, Third-party connections.</p>

<h2>Contact</h2>
<p>Questions go to ${owner}, who runs this copy of Hum. Hum's code is open source at <a href="https://github.com/marionschleifer/hum">github.com/marionschleifer/hum</a>.</p>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
