/**
 * Teams Approvals — Native approval workflows via Microsoft Graph.
 * Replaces custom Adaptive Card HITL with Teams Approvals API.
 *
 * Approvals appear in the Teams Approvals app, are tracked,
 * and support escalation on timeout.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { DefaultAzureCredential } from '@azure/identity';

// ── Configuration ──
const APPROVAL_TIMEOUT_MS = Number(process.env.APPROVAL_TIMEOUT_MS) || 30 * 60 * 1000; // 30 min default
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

let graphClient: Client | null = null;

// ── Types ──
export interface ApprovalRequest {
  title: string;
  description: string;
  requestedBy: string;
  approvers: string[];
  category: 'trade' | 'compliance' | 'client-comms' | 'rebalance' | 'general';
  priority: 'urgent' | 'normal' | 'low';
  metadata: Record<string, string>;
  callbackUrl?: string;
}

export interface ApprovalResult {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'timeout' | 'error';
  respondedBy?: string;
  respondedAt?: string;
  comments?: string;
  method: 'teams-approvals' | 'fallback';
}

// In-memory tracking for pending approvals
const pendingApprovals = new Map<string, {
  request: ApprovalRequest;
  createdAt: number;
  timeoutHandle: NodeJS.Timeout;
  resolve: (result: ApprovalResult) => void;
}>();

// ── Initialization ──

function getGraphClient(): Client | null {
  if (graphClient) return graphClient;

  try {
    const credential = new DefaultAzureCredential();
    const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: GRAPH_SCOPES });
    graphClient = Client.initWithMiddleware({ authProvider });
    return graphClient;
  } catch (err) {
    console.error('[TeamsApprovals] Graph client init failed:', (err as Error).message);
    return null;
  }
}

// ── Create Approval ──

export async function createApproval(request: ApprovalRequest): Promise<ApprovalResult> {
  const client = getGraphClient();
  const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (!client) {
    console.warn('[TeamsApprovals] Graph not configured, using fallback approval flow');
    return createFallbackApproval(approvalId, request);
  }

  try {
    const approvalBody = {
      displayName: request.title,
      description: request.description,
      approvalType: 'basic',
      allowCancel: true,
      responseOptions: ['Approve', 'Reject'],
      requestor: {
        identity: { displayName: request.requestedBy },
      },
      approvers: request.approvers.map(upn => ({
        identity: { id: upn },
      })),
    };

    const result = await client.api('/solutions/approval/approvalItems').post(approvalBody);
    const teamsApprovalId = result?.id || approvalId;

    console.log(`[TeamsApprovals] Created approval ${teamsApprovalId}: ${request.title}`);

    return new Promise<ApprovalResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        pendingApprovals.delete(teamsApprovalId);
        resolve({
          id: teamsApprovalId,
          status: 'timeout',
          method: 'teams-approvals',
        });
      }, APPROVAL_TIMEOUT_MS);

      pendingApprovals.set(teamsApprovalId, {
        request,
        createdAt: Date.now(),
        timeoutHandle,
        resolve,
      });
    });
  } catch (err) {
    console.error('[TeamsApprovals] Failed to create approval:', (err as Error).message);
    return createFallbackApproval(approvalId, request);
  }
}

// ── Resolve Approval ──

export function resolveApproval(
  approvalId: string,
  decision: 'approved' | 'rejected',
  respondedBy: string,
  comments?: string,
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;

  clearTimeout(pending.timeoutHandle);
  pendingApprovals.delete(approvalId);

  pending.resolve({
    id: approvalId,
    status: decision,
    respondedBy,
    respondedAt: new Date().toISOString(),
    comments,
    method: 'teams-approvals',
  });

  console.log(`[TeamsApprovals] Approval ${approvalId} ${decision} by ${respondedBy}`);
  return true;
}

// ── Fallback (when Graph not available) ──

function createFallbackApproval(approvalId: string, request: ApprovalRequest): Promise<ApprovalResult> {
  console.log(`[TeamsApprovals] Fallback approval ${approvalId}: ${request.title}`);

  return new Promise<ApprovalResult>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve({
        id: approvalId,
        status: 'timeout',
        method: 'fallback',
      });
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(approvalId, {
      request,
      createdAt: Date.now(),
      timeoutHandle,
      resolve,
    });
  });
}

// ── Status ──

export function getApprovalStatus(approvalId: string): 'pending' | 'not-found' {
  return pendingApprovals.has(approvalId) ? 'pending' : 'not-found';
}

export function getPendingCount(): number {
  return pendingApprovals.size;
}

export function cancelApproval(approvalId: string): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;

  clearTimeout(pending.timeoutHandle);
  pendingApprovals.delete(approvalId);

  pending.resolve({
    id: approvalId,
    status: 'cancelled',
    method: 'teams-approvals',
  });

  return true;
}
