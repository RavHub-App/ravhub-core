# RavHub Documentation

Welcome to the technical documentation for RavHub.

## 🏢 Product (On-Premise / Self-Hosted)

Documentation for end-users deploying RavHub in their own infrastructure.

- **[Docker Guide](./on-premise/DOCKER_GUIDE.md)**: Instructions for deploying on a single server using Docker Compose or CLI.
- **[Kubernetes Guide (Helm)](./on-premise/HELM_GUIDE.md)**: Instructions for deploying on Kubernetes using the official Helm Chart.
- **[Configuration Reference](./on-premise/CONFIGURATION.md)**: Detailed reference of all configuration options (Env Vars & Values).
- **[RBAC & Permissions](./on-premise/PERMISSIONS.md)**: Guide to User Roles and Repository Permissions.
- **[Architecture](./on-premise/ARCHITECTURE.md)**: Technical overview of the system components and data flow.

## ☁️ License Portal (Internal)

Documentation for the RavHub team regarding the SaaS License Management Platform.

- **[Portal Deployment](./license-portal/DEPLOYMENT.md)**: Deployment and secret management for the License Portal.

## 👨‍💻 Development

Internal guides for contributors and developers of RavHub.

- **[Testing Config](./development/TESTING.md)**: How to run tests locally.
- **[On-Premise Coverage](./development/TEST-COVERAGE-ONPREMISE.md)**: Test scenarios for the on-premise components.
- **[Plugin System](./development/DYNAMIC-PLUGIN-RELOAD.md)**: Deep dive into the dynamic plugin reloading architecture.
