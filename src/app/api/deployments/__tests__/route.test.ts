import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db/client";
import { deployments } from "@/lib/db/schema";

/**
 * Test Suite for Manual Deployment Event API
 *
 * Tests cover:
 * - Successful deployment creation (201)
 * - Request validation (400)
 * - Authentication/authorization (401)
 * - Database persistence
 * - Error handling (500)
 *
 * Note: These are integration tests that require:
 * - Test database
 * - DEPLOYMENT_API_KEY environment variable
 */

const API_URL = "http://localhost:3000/api/deployments";
const VALID_API_KEY = process.env.DEPLOYMENT_API_KEY || "test_api_key_12345";

// Test data
const validDeployment = {
  environment: "production",
  commitSha: "abc1234567890def1234567890abcdef12345678",
  deployedAt: "2025-11-09T10:30:00Z",
  projectName: "test-project",
  orgName: "test-org",
  status: "success",
  deployedBy: "test.user@example.com",
  notes: "Test deployment",
};

describe("POST /api/deployments", () => {
  // Clean up test data before and after each test
  beforeEach(async () => {
    await db.delete(deployments);
  });

  afterEach(async () => {
    await db.delete(deployments);
  });

  describe("Authentication", () => {
    test("should return 401 when Authorization header is missing", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validDeployment),
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when Authorization scheme is not Bearer", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${VALID_API_KEY}`,
        },
        body: JSON.stringify(validDeployment),
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when API key is invalid", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid_key",
        },
        body: JSON.stringify(validDeployment),
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when request body is not valid JSON", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: "invalid json{",
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid JSON");
    });

    test("should return 400 when required field 'environment' is missing", async () => {
      const invalidData = { ...validDeployment };
      delete (invalidData as any).environment;

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
    });

    test("should return 400 when 'environment' has invalid value", async () => {
      const invalidData = {
        ...validDeployment,
        environment: "invalid-env",
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
      expect(data.details.environment).toBeDefined();
    });

    test("should return 400 when 'commitSha' is not 40 characters", async () => {
      const invalidData = {
        ...validDeployment,
        commitSha: "abc123", // Too short
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
      expect(data.details.commitSha).toBeDefined();
    });

    test("should return 400 when 'commitSha' contains invalid characters", async () => {
      const invalidData = {
        ...validDeployment,
        commitSha: "xyz1234567890xyz1234567890xyz123456789z", // Invalid hex
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
      expect(data.details.commitSha).toBeDefined();
    });

    test("should return 400 when 'deployedAt' is not valid ISO 8601", async () => {
      const invalidData = {
        ...validDeployment,
        deployedAt: "2025-11-09", // Missing time portion
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
      expect(data.details.deployedAt).toBeDefined();
    });

    test("should return 400 when 'projectName' is missing", async () => {
      const invalidData = { ...validDeployment };
      delete (invalidData as any).projectName;

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
      expect(data.details.projectName).toBeDefined();
    });

    test("should return 400 when 'status' has invalid value", async () => {
      const invalidData = {
        ...validDeployment,
        status: "pending", // Invalid status
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(invalidData),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation error");
      expect(data.details.status).toBeDefined();
    });
  });

  describe("Successful Deployment Creation", () => {
    test("should create deployment with all required fields and return 201", async () => {
      const minimalDeployment = {
        environment: "production",
        commitSha: "abc1234567890def1234567890abcdef12345678",
        deployedAt: "2025-11-09T10:30:00Z",
        projectName: "test-project",
        orgName: "test-org",
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(minimalDeployment),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.deployment).toBeDefined();
      expect(data.deployment.environment).toBe("production");
      expect(data.deployment.commitSha).toBe(minimalDeployment.commitSha);
      expect(data.deployment.projectName).toBe("test-project");
      expect(data.deployment.orgName).toBe("test-org");
      expect(data.deployment.status).toBe("success"); // Default value
      expect(data.deployment.isFailed).toBe(false);
      expect(data.deployment.deploymentId).toMatch(/^deploy_\d+_abc12345$/);
    });

    test("should create deployment with all optional fields", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(validDeployment),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.deployment).toBeDefined();
      expect(data.deployment.deployedBy).toBe("test.user@example.com");
      expect(data.deployment.notes).toBe("Test deployment");
    });

    test("should create deployment with status=failure and set isFailed=true", async () => {
      const failedDeployment = {
        ...validDeployment,
        status: "failure",
        notes: "Deployment failed due to timeout",
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(failedDeployment),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.deployment.status).toBe("failure");
      expect(data.deployment.isFailed).toBe(true);
      expect(data.deployment.failureReason).toBe(
        "Deployment failed due to timeout",
      );
    });

    test("should create deployment with different environments", async () => {
      const environments = ["production", "staging", "development"];
      const commitShas = {
        production: "aaa1234567890def1234567890abcdef12345678",
        staging: "bbb1234567890def1234567890abcdef12345678",
        development: "ccc1234567890def1234567890abcdef12345678",
      };

      for (const environment of environments) {
        const deploymentData = {
          ...validDeployment,
          commitSha: commitShas[environment as keyof typeof commitShas],
          environment: environment as "production" | "staging" | "development",
        };

        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${VALID_API_KEY}`,
          },
          body: JSON.stringify(deploymentData),
        });

        expect(response.status).toBe(201);

        const data = await response.json();
        expect(data.deployment.environment).toBe(environment);
      }
    });

    test("should persist deployment to database", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(validDeployment),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      const deploymentId = data.deployment.deploymentId;

      // Verify in database
      const [dbDeployment] = await db
        .select()
        .from(deployments)
        .where((d) => d.deploymentId === deploymentId);

      expect(dbDeployment).toBeDefined();
      expect(dbDeployment.environment).toBe("production");
      expect(dbDeployment.commitSha).toBe(validDeployment.commitSha);
      expect(dbDeployment.projectName).toBe("test-project");
      expect(dbDeployment.orgName).toBe("test-org");
      expect(dbDeployment.deployedBy).toBe("test.user@example.com");
      expect(dbDeployment.notes).toBe("Test deployment");
    });

    test("should set startedAt and completedAt to deployedAt timestamp", async () => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(validDeployment),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.deployment.startedAt).toBeDefined();
      expect(data.deployment.completedAt).toBeDefined();

      // Should be equal for manual deployments
      expect(data.deployment.startedAt).toBe(data.deployment.completedAt);

      // Should match the deployedAt timestamp
      const startedAt = new Date(data.deployment.startedAt);
      const deployedAt = new Date(validDeployment.deployedAt);
      expect(startedAt.getTime()).toBe(deployedAt.getTime());
    });

    test("should generate unique deployment IDs for different deployments", async () => {
      const deployment1 = {
        ...validDeployment,
        commitSha: "abc1234567890def1234567890abcdef12345678",
      };

      const deployment2 = {
        ...validDeployment,
        commitSha: "def1234567890abc1234567890def123456789ab",
      };

      const response1 = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(deployment1),
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response2 = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(deployment2),
      });

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.deployment.deploymentId).not.toBe(
        data2.deployment.deploymentId,
      );
    });

    test("should support multi-project deployments with different projectName values", async () => {
      const projects = ["project-a", "project-b", "project-c"];
      const commitShas = [
        "ddd1234567890def1234567890abcdef12345678",
        "eee1234567890def1234567890abcdef12345678",
        "fff1234567890def1234567890abcdef12345678",
      ];

      for (let i = 0; i < projects.length; i++) {
        const deploymentData = {
          ...validDeployment,
          commitSha: commitShas[i],
          projectName: projects[i],
        };

        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${VALID_API_KEY}`,
          },
          body: JSON.stringify(deploymentData),
        });

        expect(response.status).toBe(201);

        const data = await response.json();
        expect(data.deployment.projectName).toBe(projects[i]);
      }

      // Verify all projects in database
      const allDeployments = await db.select().from(deployments);
      expect(allDeployments.length).toBe(3);

      const projectNames = allDeployments.map((d) => d.projectName).sort();
      expect(projectNames).toEqual(["project-a", "project-b", "project-c"]);
    });
  });
});
