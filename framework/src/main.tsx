import { render } from "preact";
import { App } from "./App";
import "../../site/styles.css";
import "../../site/editor-fixes.css";
import "../../site/task-view.css";
import "../../site/sleep-view.css";
import "../../site/interactions.css";
import "../../site/keyboard.css";
import "./framework.css";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

render(<App />, root);
