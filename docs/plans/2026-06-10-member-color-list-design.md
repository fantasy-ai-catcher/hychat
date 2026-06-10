# Member Color List Design

## Goal

Show room members and their selected profile colors in the terminal UI, with a full detail view available through `/members`.

## Design

The top room panel keeps a fixed member area. It renders each room member as a colored display name followed by compact metadata, such as `(owner, rose)`. The visible member area should use a small fixed line budget so the chat viewport remains usable. If there are more members than fit, the panel shows a `+N more` summary.

The `/members` command remains the complete member detail view. It should list every current room member with role, display name, and selected color. This gives users an exact reference when the top panel is truncated.

## Data Flow

No Supabase schema change is needed. The app already loads member rows with display color data, maps them to `RoomMemberSummary.displayColor`, and stores them in `state.membersByRoom`.

## Tests

Add focused tests for:

- Top panel member rendering with color-aware `Text` elements.
- Top panel truncation when the fixed visible member budget is exceeded.
- `/members` output including role, display name, and color.

Run the targeted tests, then the repo verification commands.
