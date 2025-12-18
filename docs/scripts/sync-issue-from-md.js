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
      console.log('💡 请创建 docs/issues/ 目录并添加 .md 文件');
      return;
    }
    
    // 获取目录下所有 .md 文件
    const allFiles = fs.readdirSync(issuesDir)
      .filter(f => f.endsWith('.md') && f.match(/^(\d+)-(.+)\.md$/))
      .sort((a, b) => {
        const numA = parseInt(a.match(/^(\d+)-/)[1]);
        const numB = parseInt(b.match(/^(\d+)-/)[1]);
        return numA - numB;
      });
    
    console.log(`📁 找到 ${allFiles.length} 个符合条件的文件:`);
    
    if (allFiles.length === 0) {
      console.log('ℹ️ 没有找到格式正确的文件');
      return;
    }
    
    // 显示找到的文件
    allFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file}`);
    });
    
    // 4. 处理每个文件
    console.log('\n🔄 开始处理文件...');
    let processedCount = 0;
    let errorCount = 0;
    
    for (const fileName of allFiles) {
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
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
          console.log(`⚠️ 跳过: 文件不存在 ${filePath}`);
          continue;
        }
        
        // 读取文件内容
        let content = fs.readFileSync(filePath, 'utf8');
        
        if (!content || content.trim().length === 0) {
          console.log(`⚠️ 跳过: 文件内容为空`);
          continue;
        }
        
        // 提取标题（从第一行）
        let title = description.replace(/-/g, ' ');
        const firstLine = content.split('\n')[0].trim();
        const titleMatch = firstLine.match(/^#\d+:\s*(.+)$/);
        if (titleMatch) {
          title = titleMatch[1];
        }
        
        console.log(`📝 文件: ${fileName}`);
        console.log(`   期望编号: #${fileNumber}`);
        console.log(`   标题: "${title}"`);
        console.log(`   内容长度: ${content.length} 字符`);
        
        // 5. 智能处理：跳过已占用的编号，查找可用编号
        let actualIssueNumber = fileNumber;
        let shouldSkip = false;
        
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            // 先尝试获取该编号的Issue信息
            const existingIssue = await octokit.rest.issues.get({
              owner,
              repo,
              issue_number: actualIssueNumber
            });
            
            // 如果存在，检查类型和状态
            if (existingIssue.data.pull_request) {
              console.log(`   ⚠️ #${actualIssueNumber} 是Pull Request，尝试下一个编号`);
              actualIssueNumber++;
            } else if (existingIssue.data.state === 'closed') {
              console.log(`   ⚠️ #${actualIssueNumber} 是已关闭的Issue，尝试重新打开`);
              // 可以重新打开，跳出循环
              break;
            } else {
              // 是开放状态的Issue，可以更新
              console.log(`   📝 #${actualIssueNumber} 是已存在的开放Issue，将更新内容`);
              break;
            }
          } catch (error) {
            if (error.status === 404 || error.status === 410) {
              // 404: 不存在, 410: 已删除 - 都可以使用
              console.log(`   ✅ #${actualIssueNumber} 可用 (${error.status === 404 ? '不存在' : '已删除可重新打开'})`);
              break;
            } else {
              // 其他错误
              console.error(`   ❌ 检查编号时出错:`, error.message);
              shouldSkip = true;
              break;
            }
          }
        }
        
        if (shouldSkip) {
          console.log(`   ⏭️ 跳过文件 ${fileName}`);
          errorCount++;
          continue;
        }
        
        // 6. 更新或创建Issue
        try {
          if (actualIssueNumber !== fileNumber) {
            console.log(`   🔄 编号调整: 文件#${fileNumber} → Issue#${actualIssueNumber}`);
          }
          
          // 尝试更新现有Issue
          console.log(`   🔄 尝试更新Issue #${actualIssueNumber}...`);
          
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: actualIssueNumber,
            body: content
          });
          
          console.log(`   ✅ 成功更新Issue #${actualIssueNumber}`);
          processedCount++;
          
        } catch (updateError) {
          // 如果Issue不存在（404/410错误），则创建新的
          if (updateError.status === 404 || updateError.status === 410) {
            console.log(`   📝 Issue #${actualIssueNumber} 不存在，创建新Issue...`);
            
            const createResponse = await octokit.rest.issues.create({
              owner,
              repo,
              title: title,
              body: content,
              labels: ['auto-created', 'from-markdown']
            });
            
            const createdIssueNumber = createResponse.data.number;
            console.log(`   ✅ 创建新Issue #${createdIssueNumber}: "${title}"`);
            console.log(`   🔗 Issue链接: ${createResponse.data.html_url}`);
            processedCount++;
            
            actualIssueNumber = createdIssueNumber; // 使用实际创建的编号
          } else {
            // 其他错误
            errorCount++;
            console.error(`   ❌ 处理Issue时出错:`, updateError.message);
            continue;
          }
        }
        
        // 7. ★★★ 关键：自动重命名文件以保持编号一致 ★★★
        if (actualIssueNumber !== fileNumber) {
          console.log(`   🔄 自动重命名以保持编号一致...`);
          
          // 新文件名
          const newFileName = `${actualIssueNumber.toString().padStart(3, '0')}-${description}.md`;
          const newFilePath = path.join(issuesDir, newFileName);
          
          // 更新文件内容中的编号
          const updatedContent = content.replace(
            new RegExp(`^#${fileNumber}:`, 'm'),
            `#${actualIssueNumber}:`
          );
          
          // 先写新文件
          fs.writeFileSync(newFilePath, updatedContent, 'utf8');
          console.log(`   📝 创建新文件: ${newFileName}`);
          
          // 删除旧文件（如果新旧文件名不同）
          if (fileName !== newFileName) {
            fs.unlinkSync(filePath);
            console.log(`   🗑️ 删除旧文件: ${fileName}`);
          }
          
          console.log(`   ✅ 文件编号已更新为 #${actualIssueNumber}`);
        } else {
          console.log(`   ✅ 文件编号与Issue编号一致，无需修改`);
        }
        
      } catch (fileError) {
        errorCount++;
        console.error(`❌ 处理文件 ${fileName} 时出错:`, fileError.message);
        console.error(fileError.stack);
      }
    }
    
    // 8. 总结
    console.log('\n' + '='.repeat(50));
    console.log(`📊 处理总结:`);
    console.log(`   📁 总文件数: ${allFiles.length}`);
    console.log(`   ✅ 成功处理: ${processedCount}`);
    console.log(`   ❌ 处理失败: ${errorCount}`);
    
    if (processedCount > 0) {
      console.log(`\n🎉 处理完成！`);
      console.log(`👉 请访问以下链接查看结果:`);
      console.log(`   https://github.com/${owner}/${repo}/issues`);
      
      // 重新列出最终文件状态
      const finalFiles = fs.readdirSync(issuesDir)
        .filter(f => f.endsWith('.md') && f.match(/^(\d+)-(.+)\.md$/))
        .sort();
      
      if (finalFiles.length > 0) {
        console.log(`\n📁 最终文件列表（已自动对齐编号）:`);
        finalFiles.forEach((file, index) => {
          console.log(`   ${index + 1}. ${file}`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ 脚本执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行脚本
run();
