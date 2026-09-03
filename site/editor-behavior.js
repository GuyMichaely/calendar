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
