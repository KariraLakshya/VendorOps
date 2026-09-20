import { randomUUID } from "crypto";
import prisma from "../config/prisma/prisma.js";

/**
 * Seeds a single demo tenant ("Bruce Wayne Corp") with hiring manager and
 * IT vendor users plus 12+ contract openings spanning different roles,
 * experience ranges, and contract types — all belonging to that one
 * tenant, so tenant-isolation tests have a known-good baseline to run
 * cross-tenant leakage checks against (see seedSecondTenant below).
 */
const TENANT_NAME = "Bruce Wayne Corp";

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: "HIRING_MANAGER" | "IT_VENDOR";
}

const seedUsers: SeedUser[] = [
  { email: "bruce.wayne@waynecorp.com", firstName: "Bruce", lastName: "Wayne", role: "HIRING_MANAGER" },
  { email: "lucius.fox@waynecorp.com", firstName: "Lucius", lastName: "Fox", role: "HIRING_MANAGER" },
  { email: "vendor.alpha@itpartners.com", firstName: "Alpha", lastName: "Vendor", role: "IT_VENDOR" },
  { email: "vendor.beta@itpartners.com", firstName: "Beta", lastName: "Vendor", role: "IT_VENDOR" },
];

const openingsBlueprint = [
  { title: "Senior Backend Engineer", contractType: "C2C", location: "Gotham City", experienceMin: 5, experienceMax: 10, requiredSkills: ["Node.js", "PostgreSQL", "AWS", "Docker"] },
  { title: "Frontend Engineer (React)", contractType: "W2", location: "Remote", experienceMin: 3, experienceMax: 7, requiredSkills: ["React", "TypeScript", "CSS", "Next.js"] },
  { title: "DevOps Engineer", contractType: "C2C", location: "Metropolis", experienceMin: 4, experienceMax: 8, requiredSkills: ["Kubernetes", "AWS", "CI/CD", "Terraform"] },
  { title: "Data Engineer", contractType: "1099", location: "Remote", experienceMin: 3, experienceMax: null, requiredSkills: ["Python", "SQL", "Airflow", "Spark"] },
  { title: "Full Stack Developer", contractType: "W2", location: "Gotham City", experienceMin: 2, experienceMax: 5, requiredSkills: ["Node.js", "React", "MongoDB"] },
  { title: "QA Automation Engineer", contractType: "C2C", location: "Remote", experienceMin: 2, experienceMax: 6, requiredSkills: ["Selenium", "JavaScript", "REST API"] },
  { title: "Mobile Engineer (React Native)", contractType: "W2", location: "Metropolis", experienceMin: 3, experienceMax: 6, requiredSkills: ["React Native", "TypeScript", "iOS", "Android"] },
  { title: "Cloud Security Engineer", contractType: "C2C", location: "Remote", experienceMin: 6, experienceMax: 12, requiredSkills: ["AWS", "Security", "IAM", "Kubernetes"] },
  { title: "Machine Learning Engineer", contractType: "1099", location: "Gotham City", experienceMin: 4, experienceMax: 9, requiredSkills: ["Python", "Machine Learning", "PyTorch"] },
  { title: "Site Reliability Engineer", contractType: "C2C", location: "Remote", experienceMin: 5, experienceMax: 10, requiredSkills: ["Kubernetes", "Go", "Monitoring", "AWS"] },
  { title: "Database Administrator", contractType: "W2", location: "Metropolis", experienceMin: 4, experienceMax: 8, requiredSkills: ["PostgreSQL", "MongoDB", "Backup & Recovery"] },
  { title: "Junior Software Engineer", contractType: "W2", location: "Gotham City", experienceMin: 0, experienceMax: 2, requiredSkills: ["JavaScript", "Git", "SQL"] },
  { title: "Technical Program Manager", contractType: "C2C", location: "Remote", experienceMin: 6, experienceMax: null, requiredSkills: ["Agile", "Stakeholder Management", "JIRA"] },
];

async function upsertUser(tenantId: string, seed: SeedUser) {
  return prisma.user.upsert({
    where: { email_provider: { email: seed.email, provider: "KEYCLOAK" } },
    update: { tenantId, role: seed.role },
    create: {
      email: seed.email,
      username: seed.email.split("@")[0],
      firstName: seed.firstName,
      lastName: seed.lastName,
      role: seed.role,
      tenantId,
      provider: "KEYCLOAK",
      externalId: `seed-${randomUUID()}`,
      profileComplete: true,
    },
  });
}

async function seed() {
  console.log(`Seeding tenant "${TENANT_NAME}"...`);

  const tenant =
    (await prisma.tenants.findFirst({ where: { companyName: TENANT_NAME } })) ??
    (await prisma.tenants.create({ data: { companyName: TENANT_NAME } }));

  const users = await Promise.all(seedUsers.map((u) => upsertUser(tenant.tenantId, u)));
  const hiringManagers = users.filter((u) => u.role === "HIRING_MANAGER");

  console.log(`Seeding ${openingsBlueprint.length} openings...`);

  for (let i = 0; i < openingsBlueprint.length; i++) {
    const blueprint = openingsBlueprint[i];
    const hiringManager = hiringManagers[i % hiringManagers.length];

    const existing = await prisma.opening.findFirst({
      where: { tenantId: tenant.tenantId, title: blueprint.title },
    });
    if (existing) continue;

    await prisma.opening.create({
      data: {
        tenantId: tenant.tenantId,
        title: blueprint.title,
        description: `${blueprint.title} needed for a contract engagement at ${TENANT_NAME}.`,
        location: blueprint.location,
        contractType: blueprint.contractType,
        hiringManagerId: hiringManager.id,
        requiredSkills: blueprint.requiredSkills,
        experienceMin: blueprint.experienceMin,
        experienceMax: blueprint.experienceMax,
      },
    });
  }

  console.log("✅ Seed complete:");
  console.log(`   Tenant: ${TENANT_NAME} (${tenant.tenantId})`);
  console.log(`   Hiring managers: ${hiringManagers.map((h) => h.email).join(", ")}`);
  console.log(
    `   IT vendors: ${users.filter((u) => u.role === "IT_VENDOR").map((v) => v.email).join(", ")}`
  );
  console.log(`   Openings: ${openingsBlueprint.length}`);
}

seed()
  .catch((error) => {
    console.error("❌ Error seeding data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
