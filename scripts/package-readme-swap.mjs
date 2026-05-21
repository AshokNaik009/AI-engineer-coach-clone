/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renameSync, copyFileSync } from "fs";
import { execSync } from "child_process";

renameSync("README.md", "README.github.md");
copyFileSync("README.extension.md", "README.md");
try {
  execSync("vsce package --allow-missing-repository --no-dependencies", { stdio: "inherit" });
} finally {
  renameSync("README.github.md", "README.md");
}
