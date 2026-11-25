# Local coding agent

Restore Drill can run Qwen2.5-Coder through llama.cpp on the same computer as the rehearsal. The model receives the observed Kane failure and the exporter fault to investigate. For an unresolvable collection parent and a uniquely located ID deletion, it generates a JavaScript predicate from the actual record shapes. The workbench places that predicate around the original deletion. For other failures the model proposes an exact source edit. The rehearsal executes each candidate and returns primary-workspace diagnostics to the model when necessary. It retains the model request, response, token counts, source fingerprints and acceptance decision under the rehearsal’s private `repair-N` directory. The independent workspace stays outside the generation prompt.

## Windows setup

From the repository root, run the following in PowerShell on Windows x64 with approximately 1.5 GB of disk space. The script downloads verified CPU runtime and model files into the gitignored `.restore-drill/local-model` directory. Pass `--cache PATH` to reuse a private cache elsewhere.

```powershell
node integrations/local-agent/setup-windows.mjs
```

Sign into Kane CLI, import your workspaces and run a repair rehearsal as shown in the [project guide](../../README.md). The CLI starts a private loopback model server for the repair, verifies the model file against its configured SHA-256 digest and stops the server after generation. Local inference uses CPU time. Kane browser runs use the signed-in account’s credits.

## Existing model server

For Linux, macOS or an existing Windows setup, launch a local llama.cpp server that supports the OpenAI chat completions API and structured JSON responses. Use a model alias matching the configured server. Example with the Qwen GGUF file in the current directory:

```sh
llama-server --model qwen2.5-coder-1.5b-instruct-q4_k_m.gguf --alias Qwen2.5-Coder-1.5B-Instruct-Q4_K_M --host 127.0.0.1 --port 43891 --ctx-size 4096 --parallel 1
export RESTORE_DRILL_AGENT_ENDPOINT=http://127.0.0.1:43891
export RESTORE_DRILL_AGENT_MODEL=Qwen2.5-Coder-1.5B-Instruct-Q4_K_M
```

On PowerShell set these with `$env:RESTORE_DRILL_AGENT_ENDPOINT` and `$env:RESTORE_DRILL_AGENT_MODEL`. An existing server supplies its own model label. Only the managed setup verifies the actual weights before launch. Without a local model configured, the workbench uses the installed Codex CLI. An explicit endpoint takes precedence, and `RESTORE_DRILL_CODEX` selects an installed Codex executable when the endpoint is unset.

## Pinned components

| Component | Download | SHA-256 |
| --- | --- | --- |
| Qwen2.5-Coder-1.5B-Instruct, Q4_K_M, Apache 2.0 | [Qwen GGUF snapshot](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/tree/f86cb2c1fa58255f8052cc32aeede1b7482d4361) | `cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046` |
| llama.cpp b6851, Windows x64 CPU archive | [Official release](https://github.com/ggml-org/llama.cpp/releases/tag/b6851) | `a3ed8ac2f68435494efa1d3da8fe247301697cbcd267d0111e4f4a0f2056507d` |
