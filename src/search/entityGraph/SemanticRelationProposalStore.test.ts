import {
  SemanticRelationProposalStore,
  createToolOutputSemanticRelationAdapter,
  extractSemanticRelationProposalsFromPayload,
} from "./SemanticRelationProposalStore";

describe("SemanticRelationProposalStore", () => {
  beforeEach(() => {
    SemanticRelationProposalStore.getInstance().clear();
  });

  it("extracts semantic relation proposals from nested payload structures", () => {
    const payload = {
      type: "semantic_relation_proposals",
      data: {
        proposals: [
          {
            notePath: "Characters/Arin",
            predicate: "ally",
            targetPath: "[[Characters/Lira]]",
            confidence: 0.84,
          },
          {
            sourcePath: "Characters/Arin.md",
            relation: "rival_of",
            target: "Characters/Marek",
            confidence: 71,
          },
        ],
      },
    };

    const proposals = extractSemanticRelationProposalsFromPayload(payload);
    expect(proposals).toHaveLength(2);
    expect(proposals[0].predicate).toBe("allied_with");
    expect(proposals[0].notePath).toBe("Characters/Arin.md");
    expect(proposals[0].targetPath).toBe("Characters/Lira.md");
    expect(proposals[1].predicate).toBe("rival_of");
  });

  it("builds adapter proposals from ingested tool outputs", async () => {
    const store = SemanticRelationProposalStore.getInstance();
    const inserted = store.ingestFromToolOutput(
      "extractEntityRelations",
      JSON.stringify({
        semanticRelationProposals: [
          {
            notePath: "Characters/Arin.md",
            predicate: "allied_with",
            targetPath: "Characters/Lira.md",
            confidence: 88,
          },
        ],
      })
    );

    expect(inserted).toBe(1);

    const adapter = createToolOutputSemanticRelationAdapter();
    const proposals = await adapter.getProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].sourceField).toBe("tool:extractEntityRelations");
    expect(proposals[0].predicate).toBe("allied_with");
  });

  it("ingests explicit proposal arrays through direct API", () => {
    const store = SemanticRelationProposalStore.getInstance();
    const accepted = store.ingestProposals(
      [
        {
          notePath: "Characters/Arin",
          predicate: "ally",
          targetPath: "Characters/Lira",
          confidence: 80,
        },
      ],
      "tool:submitSemanticRelationProposals"
    );

    expect(accepted).toBe(1);
    const proposals = store.getAllProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].notePath).toBe("Characters/Arin.md");
    expect(proposals[0].targetPath).toBe("Characters/Lira.md");
    expect(proposals[0].sourceField).toBe("tool:submitSemanticRelationProposals");
  });

  it("extracts proposals from plain-text tool-call blocks", () => {
    const payload = `I found candidates.\n\n\`\`\`tool\nsubmitSemanticRelationProposals\n{\n  "proposals": [\n    {\n      "notePath": "Canon Lore/Characters/Arin",\n      "predicate": "locatedIn",\n      "targetPath": "Canon Lore/Places/Grayharbor",\n      "confidence": 72\n    },\n    {\n      "notePath": "Canon Lore/Characters/Arin",\n      "predicate": "enemy_of",\n      "targetPath": "Canon Lore/Characters/Marek",\n      "confidence": 61\n    }\n  ]\n}\n\`\`\``;

    const proposals = extractSemanticRelationProposalsFromPayload(payload);

    expect(proposals).toHaveLength(2);
    expect(proposals[0].predicate).toBe("located_in");
    expect(proposals[1].predicate).toBe("rival_of");
    expect(proposals[0].notePath).toBe("Canon Lore/Characters/Arin.md");
  });

  it("extracts submitSemanticRelationProposals payload when mixed with unrelated tool JSON text", () => {
    const payload = `{"tool":"search_vault_simple","args":{"query":"Baelmir"}}\n\n\`\`\`tool\nsubmitSemanticRelationProposals\n[\n  {"notePath":"Characters/Arin","predicate":"ally","targetPath":"Characters/Lira","confidence":81},
  {"notePath":"Characters/Arin","predicate":"enemy_of","targetPath":"Characters/Marek","confidence":63}
]\n\`\`\``;

    const proposals = extractSemanticRelationProposalsFromPayload(payload);

    expect(proposals).toHaveLength(2);
    expect(proposals[0].predicate).toBe("allied_with");
    expect(proposals[1].predicate).toBe("rival_of");
  });

  it("extracts proposals from escaped JSON text payloads", () => {
    const payload =
      '{\\"proposals\\":[{\\"notePath\\":\\"Characters/Arin.md\\",\\"predicate\\":\\"vassal_of\\",\\"targetPath\\":\\"Characters/Aenar.md\\",\\"confidence\\":95}]}';

    const proposals = extractSemanticRelationProposalsFromPayload(payload);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].predicate).toBe("vassal_of");
    expect(proposals[0].notePath).toBe("Characters/Arin.md");
  });
});
