# MVP1: RE-Archaeology Framework

## Goals

1. **Neo4j Migration**:
   - Migrate the backend database from PostgreSQL/PostGIS to Neo4j.
   - Define ontology schema in Neo4j based on Ψ, Φ, Ω mappings from `architecture.md`.
   - Update backend API endpoints to use Neo4j with Cypher queries.
   - Implement data migration scripts to transfer existing data from PostgreSQL to Neo4j.

2. **UI Enhancements**:
   - **Thread Discussion Interface**:
     - Left pane: Topics and subtopics(Sites/Researches(Discoveries)/Narratives/Data etc.).
     - Middle pane: Content related to threads matches left pane navigation and visualizations (interactive graphs, maps).
     - Right pane: Artifacts (files, images, datasets).
   - **User Registration/Login**:
     - Add user authentication system(Google Signup/Login).
     - Top-right corner: Login and registration controls, user profile(chat with RE).

3. **Deployment**:
   - Deploy the application to Google Cloud Run.
   - Ensure scalability and reliability for Neo4j and the application backend.

## Tasks

### Backend
1. **Neo4j Integration**:
   - Add Neo4j Python driver to `requirements.txt`.
   - Define Cypher-based queries for all API endpoints.
   - Implement periodic reasoning loops using Neo4j.

2. **Data Migration**:
   - Write ETL scripts to extract data from PostgreSQL/PostGIS and load it into Neo4j.
   - Test data integrity and relationships after migration.

3. **Authentication**:
   - Implement user registration and login endpoints.
   - Use JWT for session management.

### Frontend
1. **Thread Discussion UI**:
   - Design and implement a three-pane layout:
     - Left pane: List of topics and subtopics.
     - Middle pane: Content area for discussions and visualizations.
     - Right pane: Artifacts (files, images, datasets).
   - Integrate interactive graph and map visualizations.

2. **User Authentication**:
   - Add login and registration forms.
   - Display user session status in the top-right corner.

### Deployment
1. **Google Cloud Run**:
   - Configure Dockerfile and `docker-compose.yml` for Cloud Run compatibility.
   - Set up environment variables for Neo4j connection.
   - Test deployment and scalability.

## Deliverables

1. Fully functional backend using Neo4j.
2. Enhanced UI with thread discussion interface and user authentication.
3. Deployed application on Google Cloud Run.

## Timeline

1. **Week 1**:
   - Define Neo4j schema and update backend endpoints.
   - Start data migration.

2. **Week 2**:
   - Complete data migration.
   - Implement thread discussion UI.

3. **Week 3**:
   - Add user authentication.
   - Test and refine UI.

4. **Week 4**:
   - Deploy to Google Cloud Run.
   - Final testing and documentation.

## Notes

- Refer to `architecture.md` for ontology schema and mappings.
- Ensure compatibility with existing raster overlay functionality.
- Prioritize scalability and reliability in deployment.