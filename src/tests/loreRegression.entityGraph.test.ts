import { hasInlineCitations } from "@/LLMProviders/chainRunner/utils/citationUtils";
import fs from "fs";
import path from "path";

interface LoreRegressionCase {
  id: string;
  query: string;
  entityQueryMode: boolean;
  entityEvidence: boolean;
  candidateResponse: string;
  expectedAbstain: boolean;
  requiredTruthPhrases: string[];
  forbiddenPhrases: string[];
}

interface LoreRegressionFixture {
  cases: LoreRegressionCase[];
}

const MISSING_EVIDENCE_MESSAGE =
  "Insufficient entity-backed lore evidence was found for this request.";
const MISSING_CITATIONS_MESSAGE =
  "I cannot provide a lore assertion without verifiable entity evidence and inline citations.";

/**
 * Loads lore regression fixtures from disk.
 *
 * @returns Parsed fixture payload.
 */
function loadFixture(): LoreRegressionFixture {
  const fixturePath = path.join(
    __dirname,
    "fixtures",
    "lore-regression",
    "entity-graph-cases.json"
  );
  const raw = fs.readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as LoreRegressionFixture;
}

/**
 * Applies strict entity gating to a candidate response.
 *
 * @param testCase - Regression fixture case.
 * @returns Final gated response string.
 */
function applyStrictEntityGate(testCase: LoreRegressionCase): string {
  if (testCase.entityQueryMode && !testCase.entityEvidence) {
    return MISSING_EVIDENCE_MESSAGE;
  }

  if (testCase.entityQueryMode && !hasInlineCitations(testCase.candidateResponse)) {
    return MISSING_CITATIONS_MESSAGE;
  }

  return testCase.candidateResponse;
}

/**
 * Detects whether a response is one of the strict abstain messages.
 *
 * @param response - Response text.
 * @returns True when response is a strict abstain.
 */
function isStrictAbstain(response: string): boolean {
  return (
    response.includes(MISSING_EVIDENCE_MESSAGE) || response.includes(MISSING_CITATIONS_MESSAGE)
  );
}

/**
 * Evaluates truth consistency against required/forbidden phrase constraints.
 *
 * @param response - Final model response.
 * @param testCase - Fixture case with truth labels.
 * @returns True when response satisfies truth constraints.
 */
function isTruthConsistent(response: string, testCase: LoreRegressionCase): boolean {
  const normalized = response.toLowerCase();
  const hasRequired = testCase.requiredTruthPhrases.every((phrase) =>
    normalized.includes(phrase.toLowerCase())
  );
  const hasForbidden = testCase.forbiddenPhrases.some((phrase) =>
    normalized.includes(phrase.toLowerCase())
  );
  return hasRequired && !hasForbidden;
}

describe("Entity graph lore regression benchmark", () => {
  it("meets citation, abstain, and contradiction acceptance thresholds", () => {
    const fixture = loadFixture();
    expect(fixture.cases.length).toBeGreaterThan(0);

    const results = fixture.cases.map((testCase) => {
      const finalResponse = applyStrictEntityGate(testCase);
      const abstained = isStrictAbstain(finalResponse);
      const hasCitations = hasInlineCitations(finalResponse);
      const truthConsistent = abstained ? true : isTruthConsistent(finalResponse, testCase);

      return {
        testCase,
        finalResponse,
        abstained,
        hasCitations,
        truthConsistent,
      };
    });

    for (const result of results) {
      expect(result.abstained).toBe(result.testCase.expectedAbstain);
    }

    const answeredEntityResults = results.filter(
      (result) => result.testCase.entityQueryMode && !result.abstained
    );
    expect(answeredEntityResults.length).toBeGreaterThan(0);

    const citationPresenceRate =
      answeredEntityResults.filter((result) => result.hasCitations).length /
      answeredEntityResults.length;
    expect(citationPresenceRate).toBeGreaterThanOrEqual(0.95);

    const missingEvidenceResults = results.filter(
      (result) => result.testCase.entityQueryMode && !result.testCase.entityEvidence
    );
    expect(missingEvidenceResults.length).toBeGreaterThan(0);

    const missingEvidenceAbstainPrecision =
      missingEvidenceResults.filter((result) => result.abstained).length /
      missingEvidenceResults.length;
    expect(missingEvidenceAbstainPrecision).toBeGreaterThanOrEqual(0.95);

    const contradictionRate =
      answeredEntityResults.filter((result) => !result.truthConsistent).length /
      answeredEntityResults.length;
    expect(contradictionRate).toBeLessThanOrEqual(0.02);
  });
});
