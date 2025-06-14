"""
Visualization Tools for Bidirectional G₂ Detection
=================================================

Tools for visualizing positive/negative feature interactions and
debugging the bidirectional evidence resolution process.

Author: G₂ Detection Kernel
Date: June 14, 2025
"""

import numpy as np
import matplotlib.pyplot as plt
from typing import Dict, List, Any
import seaborn as sns


class G2VisualizationTools:
    """Tools for visualizing bidirectional G₂ detection results."""
    
    def __init__(self):
        self.colors = {
            'positive': '#2E8B57',  # Sea Green
            'negative': '#DC143C',  # Crimson
            'neutral': '#708090',   # Slate Gray
            'background': '#F5F5DC' # Beige
        }
    
    def plot_evidence_breakdown(self, results: Dict, save_path: str = None):
        """
        Create a detailed breakdown visualization of positive vs negative evidence.
        
        Args:
            results: Results dictionary from bidirectional analysis
            save_path: Optional path to save the plot
        """
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 12))
        
        # 1. Evidence Balance Chart
        self._plot_evidence_balance(ax1, results)
        
        # 2. Feature Scores Radar
        self._plot_feature_radar(ax2, results)
        
        # 3. Confidence vs Score Scatter
        self._plot_confidence_analysis(ax3, results)
        
        # 4. Evidence Flow Diagram
        self._plot_evidence_flow(ax4, results)
        
        plt.suptitle(f"G₂ Bidirectional Analysis: {results['scenario'].upper()}", 
                     fontsize=16, fontweight='bold')
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        
        plt.show()
    
    def _plot_evidence_balance(self, ax, results: Dict):
        """Plot positive vs negative evidence balance."""
        pos_features = results['positive_features']
        neg_features = results['negative_features']
        
        # Calculate weighted scores
        pos_scores = [data['score'] * data['weight'] for data in pos_features.values()]
        neg_scores = [data['score'] * data['weight'] for data in neg_features.values()]
        
        pos_total = sum(pos_scores)
        neg_total = sum(neg_scores)
        
        # Create balance visualization
        categories = ['Positive\nEvidence', 'Negative\nEvidence']
        values = [pos_total, neg_total]
        colors = [self.colors['positive'], self.colors['negative']]
        
        bars = ax.bar(categories, values, color=colors, alpha=0.7, edgecolor='black')
        
        # Add value labels
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height + 0.1,
                   f'{value:.2f}', ha='center', va='bottom', fontweight='bold')
        
        ax.set_title('Evidence Balance', fontweight='bold')
        ax.set_ylabel('Weighted Score Sum')
        ax.grid(axis='y', alpha=0.3)
        
        # Add final score indicator
        final_score = results['final_score']
        ax.axhline(y=final_score * max(values), color='purple', 
                  linestyle='--', linewidth=2, alpha=0.8, 
                  label=f'Final Score: {final_score:.3f}')
        ax.legend()
    
    def _plot_feature_radar(self, ax, results: Dict):
        """Create radar chart of individual feature contributions."""
        all_features = {}
        all_features.update(results['positive_features'])
        all_features.update(results['negative_features'])
        
        feature_names = list(all_features.keys())
        scores = [data['score'] for data in all_features.values()]
        
        # Radar chart setup
        angles = np.linspace(0, 2 * np.pi, len(feature_names), endpoint=False).tolist()
        scores += scores[:1]  # Complete the circle
        angles += angles[:1]
        
        ax.plot(angles, scores, 'o-', linewidth=2, color='navy')
        ax.fill(angles, scores, alpha=0.25, color='navy')
        
        # Customize
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels([name.replace('_', '\n') for name in feature_names], 
                          fontsize=9)
        ax.set_ylim(0, 1)
        ax.set_title('Feature Scores Radar', fontweight='bold')
        ax.grid(True)
    
    def _plot_confidence_analysis(self, ax, results: Dict):
        """Plot confidence analysis."""
        final_score = results['final_score']
        confidence = results['confidence']
        
        # Create confidence zones
        x = np.linspace(0, 1, 100)
        y = np.linspace(0, 1, 100)
        X, Y = np.meshgrid(x, y)
        
        # Define confidence zones
        zones = np.zeros_like(X)
        zones[(X > 0.7) & (Y > 0.7)] = 3  # High confidence, high score
        zones[(X > 0.7) & (Y < 0.4)] = 1  # High confidence, low score
        zones[(X < 0.4) & (Y > 0.7)] = 2  # Low confidence, high score
        
        # Plot zones
        colors = ['white', 'lightcoral', 'lightyellow', 'lightgreen']
        ax.contourf(X, Y, zones, levels=[0, 0.5, 1.5, 2.5, 3.5], 
                   colors=colors, alpha=0.6)
        
        # Plot current result
        ax.scatter(final_score, confidence, s=200, c='red', 
                  marker='*', edgecolor='black', linewidth=2,
                  label=f'Current: ({final_score:.3f}, {confidence:.3f})')
        
        ax.set_xlabel('Final G₂ Score')
        ax.set_ylabel('Confidence')
        ax.set_title('Score vs Confidence Analysis', fontweight='bold')
        ax.legend()
        ax.grid(True, alpha=0.3)
    
    def _plot_evidence_flow(self, ax, results: Dict):
        """Create evidence flow diagram."""
        pos_features = results['positive_features']
        neg_features = results['negative_features']
        
        # Prepare data
        feature_names = []
        scores = []
        polarities = []
        
        for name, data in pos_features.items():
            feature_names.append(name.replace('_', '\n'))
            scores.append(data['score'] * data['weight'])
            polarities.append('positive')
        
        for name, data in neg_features.items():
            feature_names.append(name.replace('_', '\n'))
            scores.append(-(data['score'] * data['weight']))  # Negative for display
            polarities.append('negative')
        
        # Create horizontal bar chart
        colors = [self.colors['positive'] if p == 'positive' else self.colors['negative'] 
                 for p in polarities]
        
        y_pos = np.arange(len(feature_names))
        bars = ax.barh(y_pos, scores, color=colors, alpha=0.7, edgecolor='black')
        
        # Customize
        ax.set_yticks(y_pos)
        ax.set_yticklabels(feature_names, fontsize=9)
        ax.set_xlabel('Weighted Contribution')
        ax.set_title('Evidence Flow Diagram', fontweight='bold')
        ax.axvline(x=0, color='black', linewidth=1)
        ax.grid(axis='x', alpha=0.3)
        
        # Add final score line
        final_contribution = results['final_score'] * max(abs(min(scores)), max(scores))
        ax.axvline(x=final_contribution, color='purple', 
                  linestyle='--', linewidth=2, alpha=0.8,
                  label=f'Final Score')
        ax.legend()
    
    def plot_comparative_analysis(self, all_results: Dict[str, Dict], 
                                save_path: str = None):
        """
        Create comparative analysis across multiple scenarios.
        
        Args:
            all_results: Dictionary of scenario results
            save_path: Optional path to save the plot
        """
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(16, 12))
        
        # 1. Score Comparison
        self._plot_score_comparison(ax1, all_results)
        
        # 2. Evidence Profile Heatmap
        self._plot_evidence_heatmap(ax2, all_results)
        
        # 3. Confidence Distribution
        self._plot_confidence_distribution(ax3, all_results)
        
        # 4. Classification Summary
        self._plot_classification_summary(ax4, all_results)
        
        plt.suptitle('G₂ Bidirectional System - Comparative Analysis', 
                     fontsize=16, fontweight='bold')
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        
        plt.show()
    
    def _plot_score_comparison(self, ax, all_results: Dict):
        """Compare final scores across scenarios."""
        scenarios = list(all_results.keys())
        scores = [results['final_score'] for results in all_results.values()]
        confidences = [results['confidence'] for results in all_results.values()]
        
        # Create bars with confidence-based colors
        colors = plt.cm.RdYlGn([c for c in confidences])
        bars = ax.bar(scenarios, scores, color=colors, alpha=0.8, edgecolor='black')
        
        # Add score labels
        for bar, score in zip(bars, scores):
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height + 0.01,
                   f'{score:.3f}', ha='center', va='bottom', fontweight='bold')
        
        ax.set_title('G₂ Score Comparison', fontweight='bold')
        ax.set_ylabel('Final G₂ Score')
        ax.set_ylim(0, 1.1)
        ax.tick_params(axis='x', rotation=45)
        ax.grid(axis='y', alpha=0.3)
        
        # Add threshold lines
        ax.axhline(y=0.8, color='green', linestyle='--', alpha=0.7, label='Strong')
        ax.axhline(y=0.6, color='orange', linestyle='--', alpha=0.7, label='Moderate')
        ax.axhline(y=0.4, color='red', linestyle='--', alpha=0.7, label='Weak')
        ax.legend()
    
    def _plot_evidence_heatmap(self, ax, all_results: Dict):
        """Create heatmap of evidence across scenarios."""
        scenarios = list(all_results.keys())
        
        # Collect all feature names
        all_feature_names = set()
        for results in all_results.values():
            all_feature_names.update(results['positive_features'].keys())
            all_feature_names.update(results['negative_features'].keys())
        
        all_feature_names = sorted(list(all_feature_names))
        
        # Build matrix
        matrix = np.zeros((len(scenarios), len(all_feature_names)))
        
        for i, scenario in enumerate(scenarios):
            results = all_results[scenario]
            for j, feature_name in enumerate(all_feature_names):
                if feature_name in results['positive_features']:
                    matrix[i, j] = results['positive_features'][feature_name]['score']
                elif feature_name in results['negative_features']:
                    matrix[i, j] = -results['negative_features'][feature_name]['score']
        
        # Create heatmap
        sns.heatmap(matrix, 
                   xticklabels=[name.replace('_', '\n') for name in all_feature_names],
                   yticklabels=scenarios,
                   center=0, cmap='RdBu_r', 
                   annot=True, fmt='.2f',
                   cbar_kws={'label': 'Feature Score\n(+pos, -neg)'},
                   ax=ax)
        
        ax.set_title('Evidence Profile Heatmap', fontweight='bold')
        ax.tick_params(axis='x', rotation=45)
    
    def _plot_confidence_distribution(self, ax, all_results: Dict):
        """Plot confidence distribution analysis."""
        scenarios = list(all_results.keys())
        scores = [results['final_score'] for results in all_results.values()]
        confidences = [results['confidence'] for results in all_results.values()]
        
        # Scatter plot
        scatter = ax.scatter(scores, confidences, s=150, alpha=0.7, 
                           c=range(len(scenarios)), cmap='viridis',
                           edgecolor='black', linewidth=1)
        
        # Add scenario labels
        for i, scenario in enumerate(scenarios):
            ax.annotate(scenario.replace('_', '\n'), 
                       (scores[i], confidences[i]),
                       xytext=(5, 5), textcoords='offset points',
                       fontsize=9, alpha=0.8)
        
        ax.set_xlabel('Final G₂ Score')
        ax.set_ylabel('Confidence')
        ax.set_title('Score vs Confidence Distribution', fontweight='bold')
        ax.grid(True, alpha=0.3)
        
        # Add quadrant lines
        ax.axhline(y=0.7, color='gray', linestyle='--', alpha=0.5)
        ax.axvline(x=0.6, color='gray', linestyle='--', alpha=0.5)
    
    def _plot_classification_summary(self, ax, all_results: Dict):
        """Create classification summary pie chart."""
        classifications = []
        
        for results in all_results.values():
            score = results['final_score']
            confidence = results['confidence']
            
            if confidence < 0.6:
                classifications.append('Uncertain')
            elif score > 0.7:
                classifications.append('Archaeological')
            elif score > 0.5:
                classifications.append('Potential')
            else:
                classifications.append('Natural/Other')
        
        # Count classifications
        from collections import Counter
        counts = Counter(classifications)
        
        # Create pie chart
        colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4']
        wedges, texts, autotexts = ax.pie(counts.values(), 
                                         labels=counts.keys(),
                                         colors=colors,
                                         autopct='%1.1f%%',
                                         startangle=90)
        
        ax.set_title('Classification Summary', fontweight='bold')


def create_demo_visualizations(results: Dict):
    """Create comprehensive visualizations for demo results."""
    visualizer = G2VisualizationTools()
    
    # Individual scenario analysis
    for scenario_name, scenario_results in results.items():
        print(f"Creating visualization for {scenario_name}...")
        visualizer.plot_evidence_breakdown(
            scenario_results, 
            save_path=f"g2_analysis_{scenario_name}.png"
        )
    
    # Comparative analysis
    print("Creating comparative analysis...")
    visualizer.plot_comparative_analysis(
        results,
        save_path="g2_comparative_analysis.png"
    )
    
    print("✅ All visualizations created!")
