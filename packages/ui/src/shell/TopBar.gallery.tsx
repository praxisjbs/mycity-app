import type { GalleryEntry } from "../testing/gallery";
import { Button, IconButton } from "../actions/Button";
import { SearchButton, TopBar } from "./TopBar";

export default {
  component: "TopBar",
  states: {
    Default: () => (
      <TopBar
        start={<IconButton icon="panel" label="Collapse Menu" />}
        search={<SearchButton onClick={() => undefined} />}
        actions={
          <>
            <Button icon="clock" size="sm">
              Clock In
            </Button>
            <IconButton icon="bell" label="Notifications" dot />
          </>
        }
      />
    ),
    "Search Only": () => <SearchButton onClick={() => undefined} />,
  },
} satisfies GalleryEntry;
