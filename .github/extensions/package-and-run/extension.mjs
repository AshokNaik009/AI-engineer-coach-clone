/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

const session = await joinSession({
  tools: [
    {
      name: "package_extension",
      description:
        "Package the AI Engineer Coach VS Code extension, install it in VS Code, and optionally launch VS Code in the current directory. Runs scripts/test-local.sh under the hood.",
      parameters: {
        type: "object",
        properties: {
          launch: {
            type: "boolean",
            description:
              "Whether to launch VS Code after installing. Defaults to true.",
          },
        },
      },
      handler: async (args) => {
        const repoRoot = process.cwd();
        const scriptPath = resolve(repoRoot, "scripts/test-local.sh");
        const launch = args.launch !== false;

        return new Promise((res) => {
          execFile(
            "bash",
            [scriptPath],
            {
              cwd: repoRoot,
              env: {
                ...process.env,
                ...(launch ? {} : { SKIP_LAUNCH: "1" }),
              },
              timeout: 120_000,
            },
            (err, stdout, stderr) => {
              if (err) {
                res(
                  `❌ Packaging failed:\n${stderr || err.message}\n\nOutput:\n${stdout}`
                );
              } else {
                res(stdout);
              }
            }
          );
        });
      },
    },
  ],
});

await session.log(
  "📦 package-and-run skill loaded — use the package_extension tool to build, install, and launch the extension."
);
