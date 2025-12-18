const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    // ==================== 1. 初始化 ====================
    const token = process.env.GITHUB_TOKEN;
    const octokit = github.getOctokit(token);
    const context = github.context;

    core.info(`触发事件: ${context.eventName}`);
    core.info(`仓库: ${context.repo.owner}/${context.repo.repo}`);

    // ==================== 2. 获取变更文件 ====================
    const eventName = context.eventName;
    let changedMdFiles = [];

    if (eventName === 'push') {
      const commits = context.payload.commits || [];
      for (const commit of commits) {
        changedMdFiles.push(...(commit.added || []));
        changedMdFiles.push(...(commit.modified || []));
      }
    }

    // 筛选 docs/issues/ 下的 .md 文件
    const issueMdFiles = changedMdFiles.filter(file => 
      file.startsWith('docs/issues/') && file.endsWith('.md')
    );

    if (issueMdFiles.length === 0) {
      core.info('未检测到 docs/issues/ 目录下的 .md 文件变更。');
      return;
    }

    core.info(`发现 ${issueMdFiles.length} 个需要处理的文件:`);
    issueMdFiles.forEach(file => core.info(`  - ${file}`));

    // ==================== 3. 处理每个文件 ====================
    for (const filePath of issueMdFiles) {
      core.info(`\n>>> 开始处理: ${filePath}`);
      
      try {
        const fileName = path.basename(filePath, '.md');
        
        // 匹配 [数字]-[描述] 格式 (例如: 001-更新玩家移动操作)
        const issueMatch = fileName.match(/^(\d+)-(.+)$/);
        
        if (!issueMatch) {
          core.warning(`文件名格式不正确，应为 [数字]-[描述].md (如 001-更新玩家移动操作.md)，跳过处理。`);
          continue;
        }

        const issueNumber = parseInt(issueMatch[1], 10);
        const description = issueMatch[2].trim();
        const fullPath = path.join(process.env.GITHUB_WORKSPACE, filePath);
        
        // 读取文件内容
        if (!fs.existsSync(fullPath)) {
          core.warning(`文件不存在: ${fullPath}`);
          continue;
        }
        
        let issueContent = fs.readFileSync(fullPath, 'utf8');
        
        // ==================== 4. 确定 Issue 标题 ====================
        let issueTitle = '';
        
        // 尝试从文件第一行提取标题 (格式: #001: 标题)
        const firstLine = issueContent.split('\n')[0].trim();
        const titleMatch = firstLine.match(/^#\d+:\s*(.+)$/);
        
        if (titleMatch) {
          // 使用文件内的标题
          issueTitle = titleMatch[1];
          core.info(`从文件内容提取标题: ${issueTitle}`);
        } else {
          // 使用文件名中的描述作为标题
          issueTitle = description;
          core.info(`使用文件名描述作为标题: ${issueTitle}`);
        }

        // ==================== 5. 更新或创建 Issue ====================
        try {
          // 先尝试更新 (假设 Issue 已存在)
          core.info(`尝试更新 Issue #${issueNumber}...`);
          
          await octokit.rest.issues.update({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            body: issueContent
          });
          
          core.info(`✅ 成功更新 Issue #${issueNumber}: ${issueTitle}`);
          
        } catch (updateError) {
          // 如果 Issue 不存在 (404错误)，则创建新的
          if (updateError.status === 404) {
            core.info(`Issue #${issueNumber} 不存在，将创建新 Issue...`);
            
            const createResponse = await octokit.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: issueTitle,
              body: issueContent,
              labels: ['auto-created-from-md'] // 自动添加标签，便于识别
            });

            const actualIssueNumber = createResponse.data.number;
            core.info(`✅ 成功创建新 Issue #${actualIssueNumber}: ${issueTitle}`);
            
            // 检查编号是否匹配
            if (actualIssueNumber !== issueNumber) {
              core.warning(`⚠️ 编号不匹配: 文件期望 #${issueNumber}，但 GitHub 分配了 #${actualIssueNumber}`);
              core.warning(`建议将文件重命名为: ${actualIssueNumber.toString().padStart(3, '0')}-${description}.md`);
              
              // 可选：自动更新文件中的编号引用
              if (firstLine.match(/^#\d+:/)) {
                const updatedContent = issueContent.replace(
                  /^#\d+:/,
                  `#${actualIssueNumber}:`
                );
                fs.writeFileSync(fullPath, updatedContent, 'utf8');
                core.info(`已更新文件内的编号为 #${actualIssueNumber}`);
              }
            }
            
          } else {
            // 其他错误
            core.error(`处理 Issue #${issueNumber} 时出错: ${updateError.message}`);
            throw updateError;
          }
        }

      } catch (error) {
        core.error(`处理文件 ${filePath} 时出错: ${error.message}`);
        core.error(error.stack);
        // 继续处理下一个文件，不中断工作流
      }
    }

    core.info('\n🎉 所有文件处理完成！');

  } catch (error) {
    core.setFailed(`❌ 工作流执行失败: ${error.message}`);
    core.error(error.stack);
  }
}

// 执行脚本
run();
