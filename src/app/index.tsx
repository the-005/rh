import * as React from "react";
import { Route, Switch, useLocation } from "wouter";
import allManifest from "~/src/images/manifest.json";
import { Frame } from "~/src/frame";
import { InfiniteCanvas } from "~/src/infinite-canvas";
import type { MediaItem } from "~/src/infinite-canvas/types";
import { PageLoader } from "~/src/loader";
import { ProjectPage } from "~/src/project";
import { setTransitionOrigin } from "~/src/project/transition-origin";

type Category = "all" | "art" | "commerce";

const ALL_MEDIA = allManifest as MediaItem[];

export function App() {
  const [category, setCategory] = React.useState<Category>("all");
  const [textureProgress, setTextureProgress] = React.useState(0);
  const [, navigate] = useLocation();

  return (
    <Switch>
      <Route path="/project/:id" component={ProjectPage} />
      <Route>
        <Frame category={category} onCategoryChange={setCategory} />
        <PageLoader progress={textureProgress} />
        <InfiniteCanvas
          media={ALL_MEDIA}
          activeCategory={category}
          onTextureProgress={setTextureProgress}
          onMediaClick={(item, x, y) => {
            if (item.project) {
              setTransitionOrigin(x, y);
              navigate(`/project/${item.project}`);
            }
          }}
        />
      </Route>
    </Switch>
  );
}
