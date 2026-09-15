import { render } from "solid-js/web";
import { App } from "./App";

import "./workspace.css";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

render(() => <App />, root);
