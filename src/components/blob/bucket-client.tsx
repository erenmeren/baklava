"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import type { TechId } from "@/lib/connections/types";
import { ObjectBrowser } from "./object-browser";
import { BucketSettings } from "./bucket-settings";

interface Props {
  tech: TechId;
  connectionId: string;
  bucket: string;
}

export function BucketClient({ tech, connectionId, bucket }: Props) {
  return (
    <WorkspacePage title={bucket} description="Bucket">
      <Tabs defaultValue="objects" className="flex flex-col h-full min-h-0">
        <TabsList>
          <TabsTrigger value="objects">Objects</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="objects" className="flex-1 min-h-0">
          <ObjectBrowser tech={tech} connectionId={connectionId} bucket={bucket} />
        </TabsContent>
        <TabsContent value="settings">
          <BucketSettings tech={tech} connectionId={connectionId} bucket={bucket} />
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}
