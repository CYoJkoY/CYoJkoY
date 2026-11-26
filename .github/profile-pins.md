# Profile pins

`.github/profile-pins.json` controls the generated cards in `README.md`. A pin
may use a bare repository name or a full `owner/name` slug:

```json
{
  "categories": [
    {
      "name": "Projects",
      "repos": [
        "Yoko-Windhawk-Mods",
        {
          "name": "CYoJkoY/extras-",
          "desc": "Optional custom card description."
        },
        "partner/shared-project"
      ]
    }
  ]
}
```

Repository discovery combines repositories owned by `CYoJkoY` with public
collaboration and organization repositories from the `type=member` listing.
Bare names resolve in that combined index: an owned repository wins if there is
a name collision, otherwise a single external match is used. Pins may also
reference any public repository with a full `owner/name` slug.

External repository cards are stored as `owner--repository.svg` so they cannot
overwrite an owned repository card with the same repository name. Private
repositories and the profile repository itself cannot be pinned. Resolution
errors are collected before any file is written, so invalid pins preserve the
existing cards and README section.
