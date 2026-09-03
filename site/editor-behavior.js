const eventFields = document.querySelector("#event-fields");
const eventStart = document.querySelector("[name='eventStart']");

function syncEventControls() {
  const eventActive = !eventFields.hidden;
  eventFields.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = !eventActive;
  });
  eventStart.required = eventActive;
}

new MutationObserver(syncEventControls).observe(eventFields, {
  attributes: true,
  attributeFilter: ["hidden"],
});

syncEventControls();

// Actionability and the projected recurring window change as the clock moves.
// Re-render the active view periodically so an expired window rolls forward
// without requiring a manual reload.
setInterval(() => {
  if (document.querySelector("dialog[open]")) return;
  document.querySelector(".primary-nav .nav-button.active")?.click();
}, 30_000);
