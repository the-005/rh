/** What a project says about itself (src/projects/info.json, or the admin's). */
export type ProjectInfo = {
  name?: string;
  kind?: string;
  year?: string;
  credits?: (string | { role?: string; name: string })[];
};
