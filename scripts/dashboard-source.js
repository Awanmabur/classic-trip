const fs = require('fs');
const path = require('path');

function readFile(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readDirectoryFiles(directoryPath, extension = '.ejs') {
  if (!fs.existsSync(directoryPath)) return [];
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) return readDirectoryFiles(fullPath, extension);
      return entry.isFile() && entry.name.endsWith(extension) ? [fs.readFileSync(fullPath, 'utf8')] : [];
    });
}

function readComposedDashboardSource(root = path.join(__dirname, '..')) {
  const workspacePath = path.join(root, 'src', 'views', 'dashboards', 'shared', 'workspace.ejs');
  const sectionsPath = path.join(root, 'src', 'views', 'dashboards', 'shared', 'sections');
  const dashboardHtml = [
    fs.readFileSync(workspacePath, 'utf8'),
    ...readDirectoryFiles(sectionsPath),
  ].join('\n');
  const dashboardScript = readFile(root, 'public/js/dashboard-workspace.js');
  const dashboardStyle = readFile(root, 'public/css/dashboard-workspace.css');
  return {
    html: dashboardHtml,
    script: dashboardScript,
    style: dashboardStyle,
    combined: `${dashboardHtml}\n${dashboardScript}\n${dashboardStyle}`,
  };
}

module.exports = { readComposedDashboardSource };
