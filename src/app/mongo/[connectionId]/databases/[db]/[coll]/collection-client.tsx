"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DocumentsTab } from "./documents-tab";
import { IndexesTab } from "./indexes-tab";
import { AggregateTab } from "./aggregate-tab";
import { SchemaTab } from "./schema-tab";
import { ExplainTab } from "./explain-tab";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

export function CollectionClient({ connectionId, dbName, collName }: Props) {
  return (
    <Tabs defaultValue="documents" className="space-y-4">
      <TabsList>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="schema">Schema</TabsTrigger>
        <TabsTrigger value="indexes">Indexes</TabsTrigger>
        <TabsTrigger value="aggregate">Aggregate</TabsTrigger>
        <TabsTrigger value="explain">Explain</TabsTrigger>
      </TabsList>
      <TabsContent value="documents">
        <DocumentsTab connectionId={connectionId} dbName={dbName} collName={collName} />
      </TabsContent>
      <TabsContent value="schema">
        <SchemaTab connectionId={connectionId} dbName={dbName} collName={collName} />
      </TabsContent>
      <TabsContent value="indexes">
        <IndexesTab connectionId={connectionId} dbName={dbName} collName={collName} />
      </TabsContent>
      <TabsContent value="aggregate">
        <AggregateTab connectionId={connectionId} dbName={dbName} collName={collName} />
      </TabsContent>
      <TabsContent value="explain">
        <ExplainTab connectionId={connectionId} dbName={dbName} collName={collName} />
      </TabsContent>
    </Tabs>
  );
}
