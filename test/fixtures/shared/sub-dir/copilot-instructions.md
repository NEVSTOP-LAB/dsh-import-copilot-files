# NESTED-DIR-RULE

A subdirectory of a configured path is content, not a configuration directory, so
this file must never be read. It sits here — at the subdirectory's top level —
so that a refactor which starts walking a configured path's children as
configuration roots is caught, which an only-`.github` fixture cannot do.