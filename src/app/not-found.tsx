import NotFound from "./(site)/not-found";
import SiteLayout from "./(site)/layout";

/** Unmatched URLs get the full site frame too. */
export default function RootNotFound() {
  return (
    <SiteLayout>
      <NotFound />
    </SiteLayout>
  );
}
