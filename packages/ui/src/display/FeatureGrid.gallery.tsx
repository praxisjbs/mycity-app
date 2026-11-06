import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { FeatureGrid } from "./FeatureGrid";

export default {
  component: "FeatureGrid",
  states: {
    "A Feature and Tiles": () => (
      <FeatureGrid
        feature={{
          title: "About MyCityApp",
          body: (
            <>
              <p>MyCityApp is a digital city and lifestyle platform connecting people, businesses, experiences and government services across Nigerian cities.</p>
              <p>Our apps, MyCityApp and MyLagosApp, help businesses reach customers, grow their visibility and create value through technology.</p>
            </>
          ),
          action: (
            <Button variant="primary" size="lg">
              Visit MyCityApp
            </Button>
          ),
        }}
        tiles={[
          { icon: "pin", title: "Discover Places", text: "Restaurants, experiences and the places worth knowing." },
          { icon: "calendar", title: "Find What's On", text: "Events and what is happening around you, as it happens." },
          { icon: "store", title: "Grow Businesses", text: "Merchants reach new customers and grow their visibility." },
          { icon: "landmark", title: "City Services", text: "Government services, closer to the people who use them." },
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
