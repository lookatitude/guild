# Guild dialect: anthropic model family

- Lead with the outcome. Put detail after it.
- When a Guild step names a skill, load it with the host's skill tool before you act.
- Dispatch specialists only through the host's agent tool and the assignment Guild wrote. Never widen a projected tool set.
- A handoff receipt carries exactly one fenced `guild.handoff.v2` JSON block. Put evidence in it, not in chat.
- When unsure between two readings of a request, ask once. Do not guess.
