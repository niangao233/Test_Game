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
    
    // 3. ★★★ 关键修改：直接扫描目录，不再依赖 commits 数据 ★★★
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
      .sort();
    
    console.log(`📁 找到 ${allFiles.length} 个符合条件的文件:`);
    
    if (allFiles.length === 0) {
      console.log('ℹ️ 没有找到格式正确的文件');
      console.log('💡 文件命名格式应为 "数字-描述.md"，如:');
      console.log('   ✅ 001-更新玩家移动操作.md');
      console.log('   ✅ 012-添加火球术音效.md');
      console.log('   ❌ test.md (缺少数字前缀)');
      console.log('   ❌ 001更新玩家.md (缺少连字符)');
      
      // 列出目录内容用于调试
      const allItems = fs.readdirSync(issuesDir);
      if (allItems.length > 0) {
        console.log('\n📂 目录实际内容:');
        allItems.forEach(item => {
          const fullPath = path.join(issuesDir, item);
          try {
            const stats = fs.statSync(fullPath);
            console.log(`   - ${item} (${stats.isDirectory() ? '目录' : '文件'})`);
          } catch (e) {
            console.log(`   - ${item} (无法访问)`);
          }
        });
      }
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
        
        const issueNumber = parseInt(match[1], 10);
        const description = match[2];
        const filePath = path.join(issuesDir, fileName);
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
          console.log(`⚠️ 跳过: 文件不存在 ${filePath}`);
          continue;
        }
        
        // 读取文件内容
        const content = fs.readFileSync(filePath, 'utf8');
        
        if (!content || content.trim().length === 0) {
          console.log(`⚠️ 跳过: 文件内容为空`);
          continue;
        }
        
        // 提取标题（从第一行）
        let title = description.replace(/-/g, ' '); // 将连字符替换为空格
        const firstLine = content.split('\n')[0].trim();
        const titleMatch = firstLine.match(/^#\d+:\s*(.+)$/);
        if (titleMatch) {
          title = titleMatch[1];
        }
        
        console.log(`📝 文件: ${fileName}`);
        console.log(`   Issue编号: #${issueNumber}`);
        console.log(`   标题: "${title}"`);
        console.log(`   内容长度: ${content.length} 字符`);
        
        try {
          // 尝试更新现有Issue
          console.log(`   🔄 尝试更新Issue #${issueNumber}...`);
          
          const updateResponse = await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            body: content
          });
          
          console.log(`   ✅ 成功更新Issue #${issueNumber}`);
          console.log(`   🔗 Issue链接: ${updateResponse.data.html_url}`);
          processedCount++;
          
        } catch (updateError) {
          // 如果Issue不存在（404错误），则创建新的
          if (updateError.status === 404) {
            console.log(`   📝 Issue #${issueNumber} 不存在，创建新Issue...`);
            
            const createResponse = await octokit.rest.issues.create({
              owner,
              repo,
              title: title,
              body: content,
              labels: ['auto-created', 'from-markdown']
            });
            
            const actualIssueNumber = createResponse.data.number;
            console.log(`   ✅ 创建新Issue #${actualIssueNumber}: "${title}"`);
            console.log(`   🔗 Issue链接: ${createResponse.data.html_url}`);
            processedCount++;
            
            // 如果编号不匹配，给出警告
            if (actualIssueNumber !== issueNumber) {
              console.warn(`   ⚠️ 编号不匹配: 文件期望 #${issueNumber}, GitHub分配了 #${actualIssueNumber}`);
            }
            
          } else {
            // 其他错误
            errorCount++;
            console.error(`   ❌ 处理Issue #${issueNumber}时出错:`, updateError.message);
            if (updateError.response) {
              console.error(`      状态码: ${updateError.status}`);
              console.error(`      错误信息: ${JSON.stringify(updateError.response.data)}`);
            }
          }
        }
        
      } catch (fileError) {
        errorCount++;
        console.error(`❌ 处理文件 ${fileName} 时出错:`, fileError.message);
      }
    }
    
    // 5. 总结
    console.log('\n' + '='.repeat(50));
    console.log(`📊 处理总结:`);
    console.log(`   📁 总文件数: ${allFiles.length}`);
    console.log(`   ✅ 成功处理: ${processedCount}`);
    console.log(`   ❌ 处理失败: ${errorCount}`);
    
    if (processedCount > 0) {
      console.log(`\n🎉 处理完成！`);
      console.log(`👉 请访问以下链接查看结果:`);
      console.log(`   https://github.com/${owner}/${repo}/issues`);
    } else if (errorCount > 0) {
      console.log(`\n⚠️ 没有成功处理任何文件，请检查错误信息`);
    }
    
  } catch (error) {
    console.error('❌ 脚本执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行脚本
run();