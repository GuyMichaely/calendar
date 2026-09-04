import { mount } from "svelte";
import App from "./App.svelte";
import "../../site/styles.css";
import "../../site/editor-fixes.css";
import "../../site/task-view.css";
import "../../site/sleep-view.css";
import "../../site/interactions.css";
import "../../site/keyboard.css";
import "./svelte.css";

const target = document.querySelector<HTMLElement>("#app");
if (!target) throw new Error("Missing #app mount point");

mount(App, { target });
