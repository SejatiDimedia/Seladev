import DataLoader from 'dataloader';
import mongoose from 'mongoose';
import { ProjectModel } from '../../infrastructure/database/models/project.model';
import { EnvironmentModel } from '../../infrastructure/database/models/environment.model';
import { UserModel } from '../../infrastructure/database/models/user.model';

export function createGraphQLDataLoaders() {
  return {
    // Project loader: batching findProjectById
    projectLoader: new DataLoader<string, any>(async (keys) => {
      const objectIds = keys.map(key => new mongoose.Types.ObjectId(key));
      const projects = await ProjectModel.find({ _id: { $in: objectIds } }).exec();
      const projectMap = new Map(projects.map(p => [p._id.toString(), p]));
      return keys.map(key => projectMap.get(key) || null);
    }),

    // Environment loader: batching findEnvironmentById
    environmentLoader: new DataLoader<string, any>(async (keys) => {
      const objectIds = keys.map(key => new mongoose.Types.ObjectId(key));
      const environments = await EnvironmentModel.find({ _id: { $in: objectIds } }).exec();
      const envMap = new Map(environments.map(e => [e._id.toString(), e]));
      return keys.map(key => envMap.get(key) || null);
    }),

    // User loader: batching findUserById
    userLoader: new DataLoader<string, any>(async (keys) => {
      const objectIds = keys.map(key => new mongoose.Types.ObjectId(key));
      const users = await UserModel.find({ _id: { $in: objectIds } }).exec();
      const userMap = new Map(users.map(u => [u._id.toString(), u]));
      return keys.map(key => userMap.get(key) || null);
    }),
  };
}
