export const typeDefs = `#graphql
  scalar DateTime

  type Project {
    id: ID!
    organizationId: ID!
    name: String!
    slug: String!
    description: String
    visibility: String!
    repositoryUrl: String
    tags: [String!]!
    createdAt: DateTime!
    environments: [Environment!]!
    members: [ProjectMember!]!
  }

  type Environment {
    id: ID!
    organizationId: ID!
    projectId: ID!
    name: String!
    slug: String!
    type: String!
    isProtected: Boolean!
    description: String
    variables: [EnvironmentVariable!]!
    secrets: [Secret!]!
  }

  type EnvironmentVariable {
    key: String!
    value: String!
    isSecret: Boolean!
  }

  type Secret {
    id: ID!
    organizationId: ID!
    projectId: ID!
    environmentId: ID!
    key: String!
    value: String!
    version: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type ProjectMember {
    id: ID!
    projectId: ID!
    user: User!
    role: String!
    assignedAt: DateTime!
  }

  type User {
    id: ID!
    email: String!
    mfaEnabled: Boolean!
  }

  type Deployment {
    id: ID!
    organizationId: ID!
    projectId: ID!
    environmentId: ID!
    version: Int!
    branch: String!
    commitSha: String
    commitMessage: String
    status: String!
    triggeredBy: ID!
    triggeredVia: String!
    duration: Int
    errorMessage: String
    createdAt: DateTime!
    completedAt: DateTime
    buildLogs: [String!]
    project: Project!
    environment: Environment!
  }

  type AuditLog {
    id: ID!
    organizationId: ID!
    projectId: ID
    actor: AuditLogActor!
    action: String!
    resource: AuditLogResource!
    outcome: String!
    createdAt: DateTime!
  }

  type AuditLogActor {
    userId: ID
    email: String
    ipAddress: String
    userAgent: String
  }

  type AuditLogResource {
    type: String!
    id: String!
    name: String
  }

  type DeploymentConnection {
    edges: [DeploymentEdge!]!
    pageInfo: PageInfo!
  }

  type DeploymentEdge {
    node: Deployment!
    cursor: String!
  }

  type AuditLogConnection {
    edges: [AuditLogEdge!]!
    pageInfo: PageInfo!
  }

  type AuditLogEdge {
    node: AuditLog!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Query {
    projects(orgId: ID!): [Project!]!
    project(id: ID!): Project
    environment(id: ID!): Environment
    secrets(projectId: ID!, environmentId: ID!): [Secret!]!
    revealSecret(projectId: ID!, secretId: ID!): String!
    deployments(projectId: ID!, limit: Int, cursor: String): DeploymentConnection!
    deployment(id: ID!): Deployment
    auditLogs(orgId: ID!, limit: Int, cursor: String): AuditLogConnection!
  }

  type Mutation {
    createProject(orgId: ID!, name: String!, slug: String!, description: String): Project!
    createSecret(projectId: ID!, environmentId: ID!, key: String!, value: String!, expiresAt: DateTime): Secret!
    triggerDeployment(projectId: ID!, environmentId: ID!, branch: String!, commitSha: String, commitMessage: String): Deployment!
    approveDeployment(projectId: ID!, deploymentId: ID!): Deployment!
    rejectDeployment(projectId: ID!, deploymentId: ID!): Deployment!
    cancelDeployment(projectId: ID!, deploymentId: ID!): Deployment!
  }

  type Subscription {
    deploymentStatusChanged(projectId: ID!): Deployment!
    deploymentLogAdded(deploymentId: ID!): String!
  }
`;
