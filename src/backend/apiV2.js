function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

function methodNotAllowed() {
  const error = new Error('Method not allowed');
  error.code = 'METHOD_NOT_ALLOWED';
  error.statusCode = 405;
  throw error;
}

export async function handleApiV2Request({
  method,
  pathname,
  searchParams,
  readJson,
  workspaceService
}) {
  if (pathname === '/api/v2/workspaces') {
    if (method === 'GET') {
      return {
        handled: true,
        statusCode: 200,
        data: workspaceService.listWorkspaces()
      };
    }
    if (method !== 'POST') methodNotAllowed();
    return {
      handled: true,
      statusCode: 201,
      data: workspaceService.createWorkspace(await readJson())
    };
  }

  let params = routeMatch(pathname, /^\/api\/v2\/workspaces\/([^/]+)$/);
  if (params) {
    const [workspaceId] = params;
    if (method === 'GET') {
      return {
        handled: true,
        statusCode: 200,
        data: workspaceService.getWorkspace(workspaceId)
      };
    }
    if (method === 'DELETE') {
      return {
        handled: true,
        statusCode: 200,
        data: workspaceService.deleteWorkspace(workspaceId)
      };
    }
    methodNotAllowed();
  }

  params = routeMatch(pathname, /^\/api\/v2\/workspaces\/([^/]+)\/(?:artifacts|snapshots)$/);
  if (params) {
    if (method !== 'POST') methodNotAllowed();
    return {
      handled: true,
      statusCode: 201,
      data: workspaceService.importArtifacts(params[0], await readJson())
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/workspaces\/([^/]+)\/knowledge-documents$/);
  if (params) {
    const [workspaceId] = params;
    if (method === 'GET') {
      return {
        handled: true,
        statusCode: 200,
        data: workspaceService.listKnowledgeDocuments(workspaceId)
      };
    }
    if (method === 'POST') {
      return {
        handled: true,
        statusCode: 201,
        data: workspaceService.importKnowledgeDocument(workspaceId, await readJson())
      };
    }
    methodNotAllowed();
  }

  params = routeMatch(pathname, /^\/api\/v2\/workspaces\/([^/]+)\/audit$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.getAudit(params[0])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/workspaces\/([^/]+)\/proposals$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.listProposals(params[0])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/workspaces\/([^/]+)\/validations$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.listValidations(params[0])
    };
  }

  params = routeMatch(
    pathname,
    /^\/api\/v2\/workspaces\/([^/]+)\/proposals\/([^/]+)\/decisions$/
  );
  if (params) {
    if (method !== 'POST') methodNotAllowed();
    const body = await readJson();
    return {
      handled: true,
      statusCode: 201,
      data: workspaceService.recordProposalDecision({
        workspaceId: params[0],
        proposalId: params[1],
        status: body.status,
        reviewerRole: body.reviewerRole,
        note: body.note
      })
    };
  }

  params = routeMatch(
    pathname,
    /^\/api\/v2\/workspaces\/([^/]+)\/knowledge-documents\/([^/]+)$/
  );
  if (params) {
    if (method !== 'DELETE') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.deleteKnowledgeDocument(params[0], params[1])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/snapshots\/([^/]+)$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.getSnapshot(params[0])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/snapshots\/([^/]+)\/programs$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.getPrograms(params[0])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/snapshots\/([^/]+)\/findings$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.getFindings(params[0])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/snapshots\/([^/]+)\/questions$/);
  if (params) {
    if (method !== 'POST') methodNotAllowed();
    return {
      handled: true,
      statusCode: 201,
      data: workspaceService.askQuestion(params[0], await readJson())
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/snapshots\/([^/]+)\/data-flow$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.getDataFlow(params[0])
    };
  }

  params = routeMatch(pathname, /^\/api\/v2\/snapshots\/([^/]+)\/devices\/([^/]+)$/);
  if (params) {
    if (method !== 'GET') methodNotAllowed();
    const requestedDepth = Number.parseInt(searchParams.get('maxTraceDepth') || '4', 10);
    return {
      handled: true,
      statusCode: 200,
      data: workspaceService.getDevice(params[0], params[1], {
        maxTraceDepth: Number.isFinite(requestedDepth) ? requestedDepth : 4
      })
    };
  }

  return { handled: false };
}
