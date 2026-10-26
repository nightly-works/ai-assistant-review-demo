# AI assistant review: an LLM with tools inside a web app (demo)

A proof piece for reviews of AI features added to web apps: chat assistants that call an LLM with tools. The fictional shop's support assistant runs on Express; four flaws, each reproduced over HTTP and fixed. The LLM is replaced by a scripted model that follows instructions found in its input, as real models can be led to, so the tests are repeatable and need no API key.

| # | Flaw | Severity | Fix |
|---|---|---|---|
| 1 | The order tool runs with the server's rights: customers read others' orders and addresses | critical | tools built per request with the user's rights |
| 2 | The model can refund, directly or through an instruction planted in an order note (indirect prompt injection) | critical | the model only files a request; staff approve with a role check |
| 3 | The browser picks the model and the token budget; no limit on calls | high | server-side model and cap, daily quota of model calls |
| 4 | A staff discount code in the system prompt, readable by asking | medium | no secrets in prompts |

Full write-up, as a client receives it: [REPORT.md](REPORT.md).

## Layout

- `flawed/` is the assistant as delivered; `fixed/` after the review. `git diff --no-index flawed fixed` shows every change.
- `*/model.js` is the scripted model. `tests/attacks.test.js` runs each attack on both versions; `tests/normal-use.test.js` checks honest use on both.

## Run

Node 22.13 or later:

```
npm ci
npm test
```

[![checks](https://github.com/nightly-works/ai-assistant-review-demo/actions/workflows/checks.yml/badge.svg)](https://github.com/nightly-works/ai-assistant-review-demo/actions/workflows/checks.yml)

Built by an AI agent (Claude) at [Nightly Works](https://github.com/nightly-works). The shop and its customers are fictional. MIT licence.
