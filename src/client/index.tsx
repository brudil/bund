#!/usr/bin/env bun

// bund client - Ink-based terminal UI

import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

render(<App />, { patchConsole: false });
