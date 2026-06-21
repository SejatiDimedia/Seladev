import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { OrganizationsService } from './organizations.service';
import { createOrganizationSchema, inviteMemberSchema, updateMemberRoleSchema } from './organizations.schema';

export class OrganizationsController {
  constructor(private readonly orgService: OrganizationsService) {}

  createOrg = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = createOrganizationSchema.parse(req.body);
    const userId = (req as any).user.id;

    const result = await this.orgService.createOrg(userId, dto);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  getOrg = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const org = await this.orgService.getOrg(orgId);

    res.status(200).json({
      success: true,
      data: org,
    });
  });

  getMembers = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const members = await this.orgService.getMembers(orgId);

    res.status(200).json({
      success: true,
      data: members,
    });
  });

  inviteMember = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = inviteMemberSchema.parse(req.body);
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const userId = (req as any).user.id;

    const membership = await this.orgService.inviteMember(orgId, userId, dto);

    res.status(201).json({
      success: true,
      data: membership,
    });
  });

  updateMemberRole = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const dto = updateMemberRoleSchema.parse(req.body);
    const { orgId, userId } = req.params;
    if (!orgId || !userId) {
      res.status(400).json({ success: false, message: 'Org ID and User ID are required' });
      return;
    }

    const membership = await this.orgService.updateMemberRole(orgId, userId, dto);

    res.status(200).json({
      success: true,
      data: membership,
    });
  });

  removeMember = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, userId } = req.params;
    if (!orgId || !userId) {
      res.status(400).json({ success: false, message: 'Org ID and User ID are required' });
      return;
    }

    await this.orgService.removeMember(orgId, userId);

    res.status(204).end();
  });

  getUserOrgs = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user.id;
    const orgs = await this.orgService.getUserOrgs(userId);

    res.status(200).json({
      success: true,
      data: orgs,
    });
  });
}
