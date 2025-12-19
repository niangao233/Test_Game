const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    console.log('🚀 开始同步Markdown到GitHub Issues...');
    
    // 1. 获取令牌
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('❌ 错误: 未找到 GITHUB_TOKEN 环境变量');
      process.exit(1);
    }
    
    console.log('✅ 成功获取GitHub令牌');
    
    // 2. 初始化GitHub客户端
    const octokit = github.getOctokit(token);
    const context = github.context;
    const { owner, repo } = context.repo;
    
    console.log(`📦 仓库: ${owner}/${repo}`);
    console.log(`🎯 触发事件: ${context.eventName}`);
    
    // 3. 扫描目录
    const issuesDir = path.join(process.env.GITHUB_WORKSPACE || '.', 'docs/issues/');
    console.log(`📁 扫描目录: ${issuesDir}`);
    
    // 检查目录是否存在
    if (!fs.existsSync(issuesDir)) {
      console.log(`❌ 目录不存在: ${issuesDir}`);
      return;
    }
    
    // ★★★ 关键修复：只处理当前推送涉及的文件，避免重复处理 ★★★
    let filesToProcess = [];
    
    // 如果是push事件，尝试只处理变更的文件
    if (context.eventName === 'push' && context.payload.commits) {
      const commits = context.payload.commits || [];
      for (const commit of commits) {
        const changedFiles = [...(commit.added || []), ...(commit.modified || [])];
        changedFiles.forEach(file => {
          if (file.startsWith('docs/issues/') && file.endsWith('.md')) {
            const fileName = path.basename(file);
            if (fileName.match(/^(\d+)-(.+)\.md$/)) {
              filesToProcess.push(fileName);
            }
          }
        });
      }
    }
    
    // 如果没有找到变更文件，回退到扫描所有文件
    if (filesToProcess.length === 0) {
      console.log('ℹ️ 未检测到特定变更，扫描所有文件...');
      filesToProcess = fs.readdirSync(issuesDir)
        .filter(f => f.endsWith('.md') && f.match(/^(\d+)-(.+)\.md$/))
        .sort();
    }
    
    console.log(`📁 找到 ${filesToProcess.length} 个需要处理的文件:`);
    
    if (filesToProcess.length === 0) {
      console.log('ℹ️ 没有找到需要处理的文件');
      return;
    }
    
    filesToProcess.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file}`);
    });
    
    // 4. 处理每个文件
    console.log('\n🔄 开始处理文件...');
    let processedCount = 0;
    let renamedFiles = []; // 记录重命名的文件，避免重复处理
    
    for (const fileName of filesToProcess) {
      // 跳过已经重命名的文件（避免重复处理）
      if (renamedFiles.includes(fileName)) {
        console.log(`\n⏭️ 跳过: ${fileName} (已在上一步骤中重命名)`);
        continue;
      }
      
      console.log(`\n=== 处理: ${fileName} ===`);
      
      try {
        // 解析文件名
        const match = fileName.match(/^(\d+)-(.+)\.md$/);
        if (!match) {
          console.log(`⚠️ 跳过: 文件名格式不正确`);
          continue;
        }
        
        const fileNumber = parseInt(match[1], 10);
        const description = match[2];
        const filePath = path.join(issuesDir, fileName);
        
        // 检查文件是否存在（可能已被重命名）
        if (!fs.existsSync(filePath)) {
          console.log(`⚠️ 文件不存在，可能已被重命名: ${filePath}`);
          // 检查是否有重命名后的文件
          const renamedFile = filesToProcess.find(f => f !== fileName && f.includes(`-${description}.md`));
          if (renamedFile) {
            console.log(`   ↪️ 检测到重命名文件: ${renamedFile}`);
            renamedFiles.push(renamedFile); // 标记为已处理
          }
          continue;
        }
        
        // 读取文件内容
        const content = fs.readFileSync(filePath, 'utf8');
        
        if (!content || content.trim().length === 0) {
          console.log(`⚠️ 跳过: 文件内容为空`);
          continue;
        }
        
        // 提取标题
        let title = description.replace(/-/g, ' ');
        const firstLine = content.split('\n')[0].trim();
        const titleMatch = firstLine.match(/^#\d+:\s*(.+)$/);
        if (titleMatch) {
          title = titleMatch[1];
        }
        
        console.log(`📝 文件: ${fileName}`);
        console.log(`   期望编号: #${fileNumber}`);
        console.log(`   标题: "${title}"`);
        
        // 5. 查找Issue编号
        let actualIssueNumber = fileNumber;
        let foundAvailable = false;
        
        //判断issue状态，决定修改或创建
        try {
          const existingIssue = await octokit.rest.issues.get({
            owner,
            repo,
            issue_number: actualIssueNumber
          });
          console.log(existingIssue.data.state);
          // 检查是否可更新
          if (existingIssue.data.pull_request) {
            console.log(`   ⚠️ #${actualIssueNumber} 是PR，不可用`);
            continue;
          } else if (existingIssue.data.state === 'closed') {
            console.log(`   ℹ️ #${actualIssueNumber} 是已关闭的Issue，不可用`);
            continue;
          } else if (existingIssue.data.state === 'open') {
            console.log(`   📝 #${actualIssueNumber} 是开放Issue，将更新内容`);
            foundAvailable = true;
          }else{
            console.log(`   ⚠️ #${actualIssueNumber} 状态未知，不可用`);
            continue;
          }
        } catch (error) {
          if(error.status===410){
            console.log(`   ℹ️ #${actualIssueNumber} 已被删除，不可用`);
          }
          //是否应该创建issue判断
          const issueTitles = [];
          let page = 1;
          try{
              while(true){
                const response = await octokit.rest.issues.listForRepo({
                owner,
                repo,
                state: 'all',      // 包括 open 和 closed
                per_page: 100,     // 每页最多 100 个
                page: page
              });
             if (response.data.length === 0) break;
             // 提取每个 Issue 的标题和编号
                response.data.forEach(issue => {
                  // 只记录 Issue，不记录 Pull Request
                  if (!issue.pull_request) {
                    issueTitles.push({
                      number: issue.number,
                      title: issue.title,
                      state: issue.state,
                      url: issue.html_url
                    })}});
             if (response.data.length < 100) break; // 最后一页
            page++;
        }
      
               

          }catch(error){
            console.error(`   ❌ 获取现有issue时出错:`, error.message);
          }
          let titleExists = false;
          for (const issue of issueTitles) {
            if (issue.title === title) {
              titleExists = true;
              console.log(`   ℹ️ 标题已存在于 #${issue.number} (${issue.state})，跳过创建`);
              try {
                // 尝试更新
                await octokit.rest.issues.update({
                  owner,
                  repo,
                  issue_number: issue.number,
                  body: content,
                  state: 'open' // 确保是打开状态
                });
                console.log(`   ✅ 成功更新Issue #${actualIssueNumber}`);
          
              } catch (updateError) {
          
                console.error(`   ❌ 更新Issue时出错:`, updateError.message);
                continue;
          
        }
            }
          }
          if (error.status === 404 && !titleExists ) {
          console.log(`   🆕 #${actualIssueNumber} 不存在，将创建新Issue`); 
          //创建issue 
          const createResponse = await octokit.rest.issues.create({
              owner,
              repo,
              title: title,
              body: content,
              labels: ['auto-created', 'from-markdown']
            });
            actualIssueNumber = createResponse.data.number;
            console.log(`   ✅ 创建新Issue #${actualIssueNumber}: "${title}"`);
            //console.log(filePath);
          //提醒用户md文件编号与issue编号不一致，要求其手动更改
          if(actualIssueNumber !== fileNumber)
            {
              let message="[警告，此文件的Issue编号与文件名中的编号不一致，请手动修改文件名以匹配新的Issue编号]\n"
              let c=message+content;
              const docsIndex = filePath.indexOf('docs/');
              const currentbranch=context.ref.replace('refs/heads/', '');
              let relativePath="";
              if (docsIndex !== -1) {
               relativePath = filePath.substring(docsIndex);}
               console.log(relativePath);
              const fileInfo = await octokit.rest.repos.getContent({
                owner: context.repo.owner,
                repo: context.repo.repo,
                path: relativePath,  // 如 'docs/issues/001-title.md'
                ref: currentbranch
            });
             await octokit.rest.repos.createOrUpdateFileContents({
                owner: context.repo.owner,
                repo: context.repo.repo,
                path: relativePath,
                message: message,
                content: Buffer.from(c).toString('base64'),
                sha: fileInfo.data.sha,
                branch: currentbranch
            });

              console.log("此文件编号发生变动，已提示修改");
              continue;
            }
            else{
              console.log(`   检查编号是否一致...：通过。`);
            }
            continue;
          };
          
        }
        
        
        if (!foundAvailable) {
          console.log(`   ❌ 未找到可用编号，跳过此文件`);
          continue;
        }
        
        // 6. 更新或创建Issue
        try {
          // 尝试更新
          
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: actualIssueNumber,
            body: content,
            state: 'open' // 确保是打开状态
          });
          console.log(`   ✅ 成功更新Issue #${actualIssueNumber}`);
          
        } catch (updateError) {
          
            console.error(`   ❌ 更新Issue时出错:`, updateError.message);
            continue;
          
        }
        
        // // 7. ★★★ 修复：智能文件重命名（避免重复触发）★★★
        // if (actualIssueNumber !== fileNumber) {
        //   const newFileName = `${actualIssueNumber.toString().padStart(3, '0')}-${description}.md`;
        //   const newFilePath = path.join(issuesDir, newFileName);
          
        //   // 只有在新文件不存在时才重命名
        //   if (!fs.existsSync(newFilePath)) {
        //     // 更新内容中的编号
        //     const updatedContent = content.replace(
        //       new RegExp(`^#${fileNumber}:`, 'm'),
        //       `#${actualIssueNumber}:`
        //     );
            
        //     // 写入新文件
        //     fs.writeFileSync(newFilePath, updatedContent, 'utf8');
        //     console.log(`   📝 创建: ${newFileName}`);
            
        //     // 删除旧文件
        //     if (fileName !== newFileName) {
        //       fs.unlinkSync(filePath);
        //       console.log(`   🗑️ 删除: ${fileName}`);
        //     }
            
        //     // 记录重命名，避免后续重复处理
        //     renamedFiles.push(newFileName);
            
        //     console.log(`   ✅ 文件重命名完成: #${fileNumber} → #${actualIssueNumber}`);
        //   } else {
        //     console.log(`   ⚠️ 新文件已存在，跳过重命名: ${newFileName}`);
        //   }
        // } else {
        //   console.log(`   ✅ 文件编号正确，无需修改`);
        // }
        
        // processedCount++;
        
      } catch (error) {
        console.error(`❌ 处理文件 ${fileName} 时出错:`, error.message);
      }
    }
    
    // 8. 总结
    console.log('\n' + '='.repeat(50));
    console.log(`📊 处理完成！`);
    console.log(`   成功处理: ${processedCount}/${filesToProcess.length} 个文件`);
    
    if (renamedFiles.length > 0) {
      console.log(`\n📁 重命名的文件:`);
      renamedFiles.forEach(file => console.log(`   - ${file}`));
      console.log(`\n💡 提示: 文件重命名后需要手动提交更改`);
    }
    
  } catch (error) {
    console.error('❌ 脚本执行失败:', error.message);
    process.exit(1);
  }
}

// 运行脚本
run();