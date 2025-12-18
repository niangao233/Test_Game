const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    // 1. 获取触发工作流的信息
    const token = core.getInput('repo-token', { required: true });
    const octokit = github.getOctokit(token);
    const context = github.context;

    // 2. 获取所有变更的.md文件
    const eventName = context.eventName;
    let changedMdFiles = [];

    if (eventName === 'push') {
      // 获取提交中的文件变更
      const commits = context.payload.commits || [];
      for (const commit of commits) {
        changedMdFiles.push(...(commit.added || []));
        changedMdFiles.push(...(commit.modified || []));
        // 注意：我们忽略已删除的文件
      }
    }

    // 3. 过滤出 docs/issues/ 下的 .md 文件
    const issueMdFiles = changedMdFiles.filter(file => 
      file.startsWith('docs/issues/') && file.endsWith('.md')
    );

    if (issueMdFiles.length === 0) {
      core.info('未检测到 docs/issues/ 目录下的 .md 文件变更。');
      return;
    }

    core.info(`需要同步的 Issue 文件: ${issueMdFiles.join(', ')}`);

    // 4. 处理每个变更的 .md 文件
    for (const filePath of issueMdFiles) {
      try {
        // 提取 Issue 编号 (例如: issue-015.md -> 15)
        const fileName = path.basename(filePath, '.md');
        const issueNumberMatch = fileName.match(/issue-(\d+)/);
        
        if (!issueNumberMatch) {
          core.warning(`文件 ${fileName} 不符合命名规范 (应为 issue-数字.md)，跳过。`);
          continue;
        }

        const issueNumber = parseInt(issueNumberMatch[1], 10);
        
        // 读取 .md 文件内容
        const fullPath = path.join(process.env.GITHUB_WORKSPACE, filePath);
        const issueContent = fs.readFileSync(fullPath, 'utf8');

        // 5. 通过 GitHub API 更新 Issue
        await octokit.rest.issues.update({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          body: issueContent
        });

        core.info(`✅ 成功同步 Issue #${issueNumber} (来自: ${filePath})`);
        
      } catch (error) {
        core.error(`处理文件 ${filePath} 时出错: ${error.message}`);
        // 继续处理下一个文件，不终止工作流
      }
    }

    core.info('🎉 所有 Issue 文件同步完成！');

  } catch (error) {
    core.setFailed(`工作流执行失败: ${error.message}`);
  }
}

// 运行脚本
run();