---
trigger: always_on
---

# Workflow during development

This file is a set of instructions on how to use certain npm packages.

## dotenvx

The .env file is encrypted by the `@direnvx/direnvx` npm package, here is how to use it.

1. **Question:** How do i set new values in `.env`.
   - **Answer:** You can us `node_modules/.bin/dotenvx set <name> <value>` to create a new key in `.env`.

2. **Question:** How do i get a value from `.env`
   - **Answer:** You can get a value by using `node_modules/.bin/dotenvx get <name>`
